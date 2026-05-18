import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import {
  getCurrentConversationId,
  getImageAnalysisRecorder,
  getProgressSender,
} from '../context';
import { takePendingImage } from '../../transport/image-cache';
import { analyzeImage, QuotaExhaustedError, type ImageVerdict } from '../../integrations/reality-defender';
import {
  detectSightengine,
  topGeneratorLabel,
  type SightengineVerdict,
} from '../../integrations/sightengine';
import { checkRateLimit, recordAnalysis } from '../../rate-limit/analysis-limiter';

const log = logger.child({ tool: 'analyze_image' });

type Tier = 'real' | 'uncertain' | 'fake';

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

function tierFromScore(score: number): Tier {
  if (score >= FAKE_THRESHOLD) return 'fake';
  if (score >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'real';
}

// Composite score: max of RD ensemble, RD top sub-model x 0.85, and Sightengine genai.
// See roadmap.md for the rationale (RD ensemble dilutes strong individual signals).
function compositeScore(rd: ImageVerdict | null, se: SightengineVerdict | null): number {
  const rdEnsemble = rd?.score ?? 0;
  const rdTopModel = rd
    ? rd.models.reduce((max, m) => (m.score != null && m.score > max ? m.score : max), 0)
    : 0;
  const seScore = se ? se.aiGenerated : 0;
  return Math.max(rdEnsemble, rdTopModel * 0.85, seScore);
}

type DetectorOutcome =
  | { ok: true; rd: ImageVerdict | null; rdLatencyMs: number | null; se: SightengineVerdict | null; seLatencyMs: number | null; seError?: string; rdError?: string }
  | { ok: false; error: string };

async function runDetectors(buffer: Buffer, mimetype: string): Promise<DetectorOutcome> {
  const hasRd = env.REALITY_DEFENDER_API_KEY.length > 0;
  const hasSe = env.SIGHTENGINE_API_USER.length > 0 && env.SIGHTENGINE_API_SECRET.length > 0;

  if (!hasRd && !hasSe) {
    return { ok: false, error: 'No hay detectores configurados (REALITY_DEFENDER_API_KEY o SIGHTENGINE_API_USER/SECRET)' };
  }

  const t0 = Date.now();
  const [rdSettled, seSettled] = await Promise.allSettled([
    hasRd
      ? analyzeImage(env.REALITY_DEFENDER_API_KEY, { buffer, mimetype })
      : Promise.resolve(null as ImageVerdict | null),
    hasSe
      ? detectSightengine(
          { apiUser: env.SIGHTENGINE_API_USER, apiSecret: env.SIGHTENGINE_API_SECRET, models: ['genai', 'deepfake'] },
          { buffer, mimetype },
        )
      : Promise.resolve(null as SightengineVerdict | null),
  ]);

  let rd: ImageVerdict | null = null;
  let rdLatencyMs: number | null = null;
  let rdError: string | undefined;
  if (rdSettled.status === 'fulfilled') {
    rd = rdSettled.value;
    rdLatencyMs = rd ? Date.now() - t0 : null;
  } else {
    rdError = rdSettled.reason instanceof Error ? rdSettled.reason.message : String(rdSettled.reason);
    // If RD failed due to quota, log but continue with Sightengine
    if (rdSettled.reason instanceof QuotaExhaustedError) {
      log.warn('RD quota exhausted — degrading to Sightengine-only');
    } else {
      log.error({ err: rdSettled.reason }, 'RD image analysis failed');
    }
  }

  let se: SightengineVerdict | null = null;
  let seLatencyMs: number | null = null;
  let seError: string | undefined;
  if (seSettled.status === 'fulfilled') {
    se = seSettled.value;
    seLatencyMs = se ? Date.now() - t0 : null;
  } else {
    seError = seSettled.reason instanceof Error ? seSettled.reason.message : String(seSettled.reason);
    log.warn({ err: seSettled.reason }, 'Sightengine soft-fail');
  }

  // Both failed = fatal
  if (!rd && !se) {
    return { ok: false, error: rdError ?? seError ?? 'Ambos detectores fallaron' };
  }

  return { ok: true, rd, rdLatencyMs, se, seLatencyMs, seError, rdError };
}

function formatVerdict(
  tier: Tier,
  score: number,
  rd: ImageVerdict | null,
  se: SightengineVerdict | null,
  rdError?: string,
): string {
  const pct = Math.round(score * 100);
  const generator = se ? topGeneratorLabel(se.generators) : null;

  const breakdownLines: string[] = [];
  if (rd) {
    const rdEnsemble = Math.round(rd.score * 100);
    const rdTop = rd.models.reduce((max, m) => (m.score != null && m.score > max ? m.score : max), 0);
    breakdownLines.push(`• Reality Defender (ensemble): ${rdEnsemble}% — máximo sub-modelo: ${Math.round(rdTop * 100)}%`);
  } else if (rdError) {
    breakdownLines.push(`• Reality Defender: no disponible (${rdError.includes('quota') ? 'cuota agotada' : 'error'})`);
  }
  if (se) {
    const sePct = Math.round(se.aiGenerated * 100);
    const genHint = generator ? ` (firma de ${generator})` : '';
    breakdownLines.push(`• Sightengine (genai): ${sePct}%${genHint}`);
    if (se.deepfake != null) {
      breakdownLines.push(`• Sightengine (deepfake/face-swap): ${Math.round(se.deepfake * 100)}%`);
    }
  }
  const breakdown = breakdownLines.length > 0 ? `\n\nDetalle técnico:\n${breakdownLines.join('\n')}` : '';

  if (tier === 'fake') {
    const genNote = generator ? ` Probable origen: ${generator}.` : '';
    return [
      `RESULTADO: esta imagen tiene fuertes señales de ser generada por IA (confianza ${pct}%).${genNote}`,
      `Recomendación: NO confíes en esta imagen como prueba. Si te la mandaron para pedirte plata, una clave o datos personales, verificá por otro canal — llamá directamente a la persona al número que ya conocés, o pedile otra prueba en vivo (videollamada, foto nueva con un gesto que acuerden).`,
    ].join('\n\n') + breakdown;
  }
  if (tier === 'uncertain') {
    const genNote = generator ? ` Sightengine ve una firma compatible con ${generator}, pero sin certeza.` : '';
    return [
      `RESULTADO: los detectores no se ponen de acuerdo (señal combinada ${pct}%, zona gris).${genNote}`,
      `Recomendación: no asumas que es real ni que es falsa. Verificá el contenido por otro canal — llamá directamente a la persona o pedile que te mande otra imagen o videollamada.`,
    ].join('\n\n') + breakdown;
  }
  return [
    `RESULTADO: esta imagen parece auténtica (señal de IA ${pct}%, baja).`,
    `Igual te recomiendo: si la imagen te pide plata, una clave o algo urgente, verificá por otro canal antes de actuar. Los detectores no son perfectos.`,
  ].join('\n\n') + breakdown;
}

export const analyzeImageDeepfakeTool = tool(
  async () => {
    log.info('tool invoked');
    const convKey = getCurrentConversationId();
    if (!convKey) {
      log.warn('no conversation key in AsyncLocalStorage');
      return 'Error interno: no pude identificar la conversación. Reenvíame la imagen de nuevo.';
    }

    const pending = takePendingImage(convKey);
    if (!pending) {
      log.info('cache MISS — no pending image');
      return 'No encuentro una imagen reciente para analizar. Reenvíame la imagen (o respondé a la imagen mencionándome) y pedime el análisis de nuevo.';
    }
    log.info({ bytes: pending.bytes, mime: pending.mimetype, source: pending.source }, 'cache HIT');

    // Per-JID rate limit — protect the shared 50 scans/month quota
    const rateCheck = checkRateLimit(convKey);
    if (!rateCheck.allowed) {
      const mins = Math.ceil((rateCheck.retryAfterSec ?? 60) / 60);
      log.warn({ jid: convKey, retryAfterSec: rateCheck.retryAfterSec }, 'rate limited');
      return `Has alcanzado el límite de análisis por hora (5/hora). Intentá de nuevo en ${mins} minutos.`;
    }

    const sendProgress = getProgressSender();
    if (sendProgress) {
      sendProgress('🔍 Analizando imagen con Reality Defender + Sightengine... dame unos segundos.').catch(
        (err) => log.warn({ err }, 'progress send failed'),
      );
    }

    const tAll = Date.now();
    const outcome = await runDetectors(pending.buffer, pending.mimetype);
    const totalMs = Date.now() - tAll;

    if (!outcome.ok) {
      log.error({ error: outcome.error }, 'all detectors failed');
      return `Error al analizar la imagen: ${outcome.error}. Intentá de nuevo en unos minutos.`;
    }

    const score = compositeScore(outcome.rd, outcome.se);
    const tier = tierFromScore(score);
    log.info(
      { composite: score, tier, rdScore: outcome.rd?.score, seAiGenerated: outcome.se?.aiGenerated, totalMs },
      'verdict computed',
    );

    const record = getImageAnalysisRecorder();
    if (record) {
      record({
        bytes: pending.bytes,
        mimetype: pending.mimetype,
        source: pending.source,
        fromName: pending.fromName || undefined,
        detector: outcome.rd && outcome.se ? 'reality-defender+sightengine' : outcome.rd ? 'reality-defender' : 'sightengine',
        tier,
        score,
        rawStatus: outcome.rd?.rawStatus ?? 'SE_ONLY',
        modelScores: outcome.rd?.models,
        secondaryDetector: outcome.se
          ? { provider: 'sightengine' as const, aiGenerated: outcome.se.aiGenerated, deepfake: outcome.se.deepfake, generators: outcome.se.generators as Record<string, number>, requestId: outcome.se.requestId }
          : outcome.seError
          ? { provider: 'sightengine' as const, aiGenerated: 0, deepfake: null, generators: {}, requestId: '', error: outcome.seError }
          : null,
        latencyMs: totalMs,
      }).catch((err) => log.warn({ err }, 'image_analyses insert failed'));
    }

    recordAnalysis(convKey);
    return formatVerdict(tier, score, outcome.rd, outcome.se, outcome.rdError);
  },
  {
    name: 'analyze_image_deepfake',
    description:
      'Analyzes the image that the user most recently shared in this conversation to determine if it is AI-generated (deepfake) or authentic. Runs Reality Defender + Sightengine in parallel and returns a composite verdict. Only call this AFTER the user has explicitly confirmed they want the analysis or when the user sends an image with an explicit question. Returns a Spanish-language verdict.',
    schema: z.object({}),
  },
);
