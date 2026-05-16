import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { env } from '../../config/env';
import {
  getCurrentConversationId,
  getImageAnalysisRecorder,
  getProgressSender,
} from '../context';
import { takePendingImage } from '../../transport/image-cache';
import { analyzeImage, type ImageVerdict } from '../../integrations/reality-defender';
import {
  detectSightengine,
  topGeneratorLabel,
  type SightengineVerdict,
} from '../../integrations/sightengine';

type Tier = 'real' | 'uncertain' | 'fake';

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

function tierFromScore(score: number): Tier {
  if (score >= FAKE_THRESHOLD) return 'fake';
  if (score >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'real';
}

// Composite score combines RD's ensemble, RD's strongest individual sub-model,
// and Sightengine's purpose-trained generator detector. The motivation:
//
//   - RD's ensemble (rd-img-ensemble) averages 10 sub-models. On a known
//     AI-generated test image we saw rd-pine-img fire at 0.99 and rd-elm-img
//     at 0.86, but the ensemble dampened to 0.48 → "uncertain". Strong single
//     signals get buried.
//   - Sightengine's `genai` is trained specifically on modern generators
//     (Flux, MJ, GPT-image, Imagen, SD, DALL·E…) and gives a calibrated 0-1.
//
// We take the max of: RD ensemble, RD's top single sub-model × 0.85, and
// Sightengine's ai_generated. The 0.85 weight on the individual RD model
// prevents one noisy detector from creating a false positive while still
// surfacing the strong-signal case the ensemble missed.
function composite(rd: ImageVerdict, se: SightengineVerdict | null): number {
  const rdEnsemble = rd.score;
  const rdTopModel = rd.models.reduce(
    (max, m) => (m.score != null && m.score > max ? m.score : max),
    0,
  );
  const seScore = se ? se.aiGenerated : 0;
  return Math.max(rdEnsemble, rdTopModel * 0.85, seScore);
}

type DetectorOutcome =
  | { ok: true; rd: ImageVerdict; rdLatencyMs: number; se: SightengineVerdict | null; seLatencyMs: number | null; seError?: string }
  | { ok: false; error: string };

async function runDetectors(buffer: Buffer, mimetype: string): Promise<DetectorOutcome> {
  const hasSe = env.SIGHTENGINE_API_USER.length > 0 && env.SIGHTENGINE_API_SECRET.length > 0;
  const tRd = Date.now();
  const tSe = Date.now();
  const [rdSettled, seSettled] = await Promise.allSettled([
    analyzeImage(env.REALITY_DEFENDER_API_KEY, { buffer, mimetype }),
    hasSe
      ? detectSightengine(
          {
            apiUser: env.SIGHTENGINE_API_USER,
            apiSecret: env.SIGHTENGINE_API_SECRET,
            models: ['genai', 'deepfake'],
          },
          { buffer, mimetype },
        )
      : Promise.resolve(null as SightengineVerdict | null),
  ]);

  // RD failure is fatal — it's our primary signal. Sightengine failure is
  // soft: we record the error in the verdict payload and proceed with RD.
  if (rdSettled.status === 'rejected') {
    const msg = rdSettled.reason instanceof Error ? rdSettled.reason.message : String(rdSettled.reason);
    return { ok: false, error: msg };
  }

  const rd = rdSettled.value;
  const rdLatencyMs = Date.now() - tRd;
  let se: SightengineVerdict | null = null;
  let seLatencyMs: number | null = null;
  let seError: string | undefined;
  if (seSettled.status === 'fulfilled') {
    se = seSettled.value;
    seLatencyMs = se ? Date.now() - tSe : null;
  } else {
    seError = seSettled.reason instanceof Error ? seSettled.reason.message : String(seSettled.reason);
    console.warn(`[tool:analyze_image] sightengine soft-fail: ${seError}`);
  }

  return { ok: true, rd, rdLatencyMs, se, seLatencyMs, seError };
}

function formatVerdict(
  tier: Tier,
  composite: number,
  rd: ImageVerdict,
  se: SightengineVerdict | null,
): string {
  const pct = Math.round(composite * 100);
  const generator = se ? topGeneratorLabel(se.generators) : null;

  // Breakdown line shown on every verdict so the user (and operator) can see
  // exactly which detector said what — useful for trust calibration and
  // hackathon demos.
  const rdEnsemble = Math.round(rd.score * 100);
  const rdTop = rd.models.reduce(
    (max, m) => (m.score != null && m.score > max ? m.score : max),
    0,
  );
  const rdTopPct = Math.round(rdTop * 100);
  const sePct = se ? Math.round(se.aiGenerated * 100) : null;
  const deepfakePct = se && se.deepfake != null ? Math.round(se.deepfake * 100) : null;

  const breakdownLines: string[] = [];
  breakdownLines.push(`• Reality Defender (ensemble): ${rdEnsemble}% — máximo sub-modelo: ${rdTopPct}%`);
  if (se && sePct != null) {
    const genHint = generator ? ` (firma de ${generator})` : '';
    breakdownLines.push(`• Sightengine (genai): ${sePct}%${genHint}`);
  }
  if (deepfakePct != null) {
    breakdownLines.push(`• Sightengine (deepfake/face-swap): ${deepfakePct}%`);
  }
  const breakdown = `Detalle técnico:\n${breakdownLines.join('\n')}`;

  if (tier === 'fake') {
    const genNote = generator ? ` Probable origen: ${generator}.` : '';
    return [
      `RESULTADO: esta imagen tiene fuertes señales de ser generada por IA (confianza ${pct}%).${genNote}`,
      `Recomendación: NO confíes en esta imagen como prueba po. Si te la mandaron para pedirte plata, una clave, datos personales, o para "probar" algo, verifica por otro canal — llama directamente a la persona al número que ya conoces, o pídele otra prueba en vivo (videollamada, foto nueva con un gesto que acuerden en el momento). Si ya transferiste o entregaste datos, llama al banco o cambia tus claves al tiro.`,
      breakdown,
    ].join('\n\n');
  }
  if (tier === 'uncertain') {
    const genNote = generator ? ` Sightengine ve una firma compatible con ${generator}, pero sin certeza.` : '';
    return [
      `RESULTADO: los detectores no se ponen de acuerdo (señal combinada ${pct}%, zona gris).${genNote}`,
      `Recomendación: no asumas que es real ni que es falsa. Verifica el contenido por otro canal — llama directamente a la persona o pídele que te mande otra imagen o videollamada con un gesto o palabra que acuerden de antemano.`,
      breakdown,
    ].join('\n\n');
  }
  return [
    `RESULTADO: esta imagen parece auténtica (señal de IA ${pct}%, baja).`,
    `Igual te recomiendo: si la imagen te pide plata, una clave o algo urgente, verifica por otro canal antes de hacer nada. Los detectores no son perfectos.`,
    breakdown,
  ].join('\n\n');
}

export const analyzeImageDeepfakeTool = tool(
  async () => {
    console.log('[tool:analyze_image] ▶ invoked');
    const convKey = getCurrentConversationId();
    if (!convKey) {
      console.warn('[tool:analyze_image] no conversation key in AsyncLocalStorage — bailing');
      return 'Error interno: no pude identificar la conversación. Reenvíame la imagen de nuevo po.';
    }
    console.log(`[tool:analyze_image] jid=${convKey}`);

    const pending = takePendingImage(convKey);
    if (!pending) {
      console.log('[tool:analyze_image] cache MISS — no pending image for this conversation');
      return 'No encuentro una imagen reciente pa\' analizar. Reenvíame la imagen (o responde a la imagen mencionándome) y pídeme el análisis de nuevo.';
    }
    console.log(
      `[tool:analyze_image] cache HIT: bytes=${pending.bytes} mime="${pending.mimetype}" source=${pending.source}`,
    );

    const sendProgress = getProgressSender();
    if (sendProgress) {
      console.log('[tool:analyze_image] → sending progress message');
      sendProgress('🔍 Analizando imagen con Reality Defender + Sightengine... dame unos segundos.').catch(
        (err) => console.warn(`[tool:analyze_image] progress send failed: ${err}`),
      );
    }

    const tAll = Date.now();
    const outcome = await runDetectors(pending.buffer, pending.mimetype);
    const totalMs = Date.now() - tAll;

    if (!outcome.ok) {
      console.error(`[tool:analyze_image] ✗ RD call failed: ${outcome.error}`);
      return `Error al analizar la imagen: ${outcome.error}. Inténtalo de nuevo en unos minutos.`;
    }

    const compositeScore = composite(outcome.rd, outcome.se);
    const tier = tierFromScore(compositeScore);
    console.log(
      `[tool:analyze_image] ◀ composite=${compositeScore.toFixed(3)} tier=${tier} rd.ensemble=${outcome.rd.score.toFixed(3)} se.aiGenerated=${outcome.se?.aiGenerated?.toFixed(3) ?? 'n/a'} totalMs=${totalMs}`,
    );

    const record = getImageAnalysisRecorder();
    if (record) {
      record({
        bytes: pending.bytes,
        mimetype: pending.mimetype,
        source: pending.source,
        fromName: pending.fromName || undefined,
        detector: outcome.se ? 'reality-defender+sightengine' : 'reality-defender',
        tier,
        score: compositeScore,
        rawStatus: outcome.rd.rawStatus,
        modelScores: outcome.rd.models,
        secondaryDetector: outcome.se
          ? {
              provider: 'sightengine',
              aiGenerated: outcome.se.aiGenerated,
              deepfake: outcome.se.deepfake,
              generators: outcome.se.generators as Record<string, number>,
              requestId: outcome.se.requestId,
            }
          : outcome.seError
          ? {
              provider: 'sightengine',
              aiGenerated: 0,
              deepfake: null,
              generators: {},
              requestId: '',
              error: outcome.seError,
            }
          : null,
        latencyMs: totalMs,
      }).catch((err) => {
        const detail =
          err instanceof Error
            ? `${err.message}${err.cause ? ` (cause: ${(err.cause as Error).message ?? err.cause})` : ''}`
            : String(err);
        console.warn(`[tool:analyze_image] image_analyses insert failed: ${detail}`);
      });
    } else {
      console.warn('[tool:analyze_image] no recorder in ALS — analysis not persisted');
    }

    return formatVerdict(tier, compositeScore, outcome.rd, outcome.se);
  },
  {
    name: 'analyze_image_deepfake',
    description:
      'Analyzes the image that the user most recently shared in this conversation to determine if it is AI-generated (deepfake) or authentic. Runs Reality Defender + Sightengine in parallel and returns a composite verdict. Only call this AFTER the user has explicitly confirmed they want the analysis (e.g., they replied "sí", "dale", "analizala") OR when the user sends an image with an explicit question/request alongside. Never call it preemptively without consent. Returns a Spanish-language verdict with confidence, per-detector breakdown, and next-step recommendations.',
    schema: z.object({}),
  },
);
