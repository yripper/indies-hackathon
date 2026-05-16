import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { env } from '../../config/env';
import {
  getMediaAnalysisRecorder,
  getCurrentConversationId,
  getProgressSender,
} from '../context';
import { takePendingMedia, type MediaKind } from '../../transport/media-cache';
import {
  analyzeMedia,
  RealityDefenderHttpError,
  SUPPORTED_FORMATS_BLURB,
  UnsupportedMediaError,
} from '../../integrations/reality-defender';

type Verdict = 'real' | 'uncertain' | 'fake';

// Per-media-type Spanish labels for the verdict prose. The three-tier framing
// rule lives here (not in the system prompt) because it depends on the
// numeric score returned by the detector — keeping it in code prevents the
// LLM from "softening" the verdict on its own.
function mediaNoun(kind: MediaKind, durationSec?: number | null, fileName?: string | null): string {
  if (kind === 'audio') {
    return durationSec && durationSec > 0 ? `audio de ${durationSec}s` : 'audio';
  }
  if (kind === 'video') {
    return durationSec && durationSec > 0 ? `video de ${durationSec}s` : 'video';
  }
  if (kind === 'image') return 'imagen';
  if (kind === 'document') {
    return fileName ? `documento (${fileName})` : 'documento';
  }
  return 'archivo';
}

function fakeDescription(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return 'tiene fuertes señales de ser generado por IA (voice clone)';
    case 'image':
      return 'tiene fuertes señales de estar manipulada o ser generada por IA';
    case 'video':
      return 'tiene fuertes señales de ser deepfake o estar manipulado por IA';
    case 'document':
      return 'tiene fuertes señales de contener material generado por IA o manipulación';
  }
}

function realDescription(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return 'parece auténtico';
    case 'image':
      return 'parece auténtica';
    case 'video':
      return 'parece auténtico';
    case 'document':
      return 'no muestra señales claras de manipulación por IA';
  }
}

function fakeRecommendation(kind: MediaKind): string {
  if (kind === 'audio' || kind === 'video') {
    return 'NO confíes en este contenido. Si alguien te pidió plata, una clave o información sensible, contactá a esa persona por otro canal (llamada directa al número conocido, mensaje a otro familiar) antes de hacer nada. Si ya transferiste, llamá al banco ahora.';
  }
  if (kind === 'image') {
    return 'NO uses esta imagen como prueba de nada. Si te la mandaron como "evidencia" (un comprobante, una foto comprometedora, una identificación), verificá por otro canal antes de actuar — llamá directamente a la persona o pedile otra prueba.';
  }
  return 'NO actúes en base a este documento. Si es un comprobante, una factura, una identificación o un contrato, verificá por otro canal (llamada al emisor real, validá número de transacción con tu banco) antes de hacer nada.';
}

function uncertainRecommendation(kind: MediaKind): string {
  if (kind === 'audio' || kind === 'video') {
    return 'no asumas que es real ni que es falso. Verificá el contenido por otro canal — llamá directamente al número de la persona o pedile que te mande otro mensaje con una palabra acordada de antemano (clave familiar).';
  }
  if (kind === 'image') {
    return 'no asumas que es real ni que es falsa. Verificá por otro canal — pedile a la persona otra foto, una llamada, o un detalle que solo ella sepa.';
  }
  return 'no asumas que el documento es genuino. Validalo por otro canal — llamá al emisor o cruzá los datos con tu banco / la entidad correspondiente.';
}

function realRecommendation(kind: MediaKind): string {
  if (kind === 'audio' || kind === 'video') {
    return 'Igual te recomiendo: si el contenido te pide plata, una clave o algo urgente, verificá por otro canal antes de actuar. Los detectores no son perfectos.';
  }
  if (kind === 'image') {
    return 'Igual te recomiendo: si la imagen se usa como prueba o pide algo urgente, verificá por otro canal antes de actuar. Los detectores no son perfectos.';
  }
  return 'Igual te recomiendo: si el documento pide plata, una clave o una acción urgente, validá por otro canal (llamá al emisor real) antes de actuar.';
}

function formatVerdict(args: {
  tier: Verdict;
  score: number;
  kind: MediaKind;
  durationSec?: number | null;
  fileName?: string | null;
}): string {
  const pct = Math.round(args.score * 100);
  const noun = mediaNoun(args.kind, args.durationSec, args.fileName);
  if (args.tier === 'fake') {
    return [
      `RESULTADO: este ${noun} ${fakeDescription(args.kind)} (confianza ${pct}%).`,
      `Recomendación: ${fakeRecommendation(args.kind)}`,
    ].join('\n\n');
  }
  if (args.tier === 'uncertain') {
    return [
      `RESULTADO: el detector no está seguro sobre este ${noun} (señal ${pct}%, zona gris).`,
      `Recomendación: ${uncertainRecommendation(args.kind)}`,
    ].join('\n\n');
  }
  return [
    `RESULTADO: este ${noun} ${realDescription(args.kind)} (señal de IA ${pct}%, baja).`,
    realRecommendation(args.kind),
  ].join('\n\n');
}

function progressMessage(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return '🔍 Analizando el audio con Reality Defender... dame unos segundos.';
    case 'image':
      return '🔍 Analizando la imagen con Reality Defender... dame unos segundos.';
    case 'video':
      return '🔍 Analizando el video con Reality Defender... puede tardar un poco (los videos pesan).';
    case 'document':
      return '🔍 Analizando el documento con Reality Defender... dame unos segundos.';
  }
}

function noPendingMessage(): string {
  return 'No encuentro un archivo reciente para analizar. Reenviame el audio / imagen / video / documento (o respondé al mensaje mencionándome) y volvé a pedirme el análisis.';
}

// User-facing Spanish error messages. We branch on error class so each
// failure mode gets actionable guidance instead of a vague "intentá de
// nuevo" — that's especially important for the unsupported-format case
// where retrying with the same file will keep failing.
function formatErrorForUser(err: unknown, kind: MediaKind): string {
  if (err instanceof UnsupportedMediaError) {
    if (err.reason === 'too_large') {
      return `El archivo es demasiado grande para el detector (${err.detail}). Reenviámelo más liviano (recortado o comprimido) y lo analizo.`;
    }
    return `No puedo analizar este formato. El detector soporta: ${SUPPORTED_FORMATS_BLURB}. Si tu ${spanishKind(kind)} viene en otro formato (por ejemplo HEIC, WebM, PDF, 3GP), reenviámelo convertido a uno de los soportados.`;
  }
  if (err instanceof RealityDefenderHttpError) {
    if (err.status === 401 || err.status === 403) {
      return 'Error de configuración del detector (API key inválida o sin permisos). Avisale al admin del bot.';
    }
    if (err.status === 400) {
      // RD echoes its reason in the body — try to surface a hint.
      const hint = extractHint(err.body);
      return `El detector rechazó el archivo${hint ? ` (${hint})` : ''}. Soporta: ${SUPPORTED_FORMATS_BLURB}.`;
    }
    if (err.status === 404) {
      return 'No encuentro el resultado del análisis. Reenviame el archivo e intentamos de nuevo.';
    }
    if (err.status >= 500) {
      return 'El detector tuvo un error temporal (servidor de Reality Defender). Esperá un minuto y reenviame el archivo para reintentar.';
    }
  }
  return 'Tuve un problema técnico al analizar el archivo. Reenviámelo e intentamos de nuevo.';
}

// Best-effort: pull a human hint out of RD's JSON error body. Their responses
// are typically `{ code: '...', response: '...' }` but sometimes other shapes.
function extractHint(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      response?: string;
      message?: string;
      code?: string;
    };
    return parsed.response || parsed.message || parsed.code || null;
  } catch {
    return body.slice(0, 80);
  }
}

function spanishKind(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return 'audio';
    case 'image':
      return 'imagen';
    case 'video':
      return 'video';
    case 'document':
      return 'documento';
  }
}

export const analyzeMediaDeepfakeTool = tool(
  async () => {
    console.log('[tool:analyze_media] ▶ invoked');
    // ALS stores the WhatsApp JID (customerPhone), which is the same key the
    // media cache uses. The variable is named "conversationId" historically
    // but it's the JID, not the DB UUID.
    const convKey = getCurrentConversationId();
    if (!convKey) {
      console.warn('[tool:analyze_media] no conversation key in AsyncLocalStorage — bailing');
      return 'Error interno: no pude identificar la conversación. Reenviame el archivo de nuevo.';
    }
    console.log(`[tool:analyze_media] jid=${convKey}`);

    const pending = takePendingMedia(convKey);
    if (!pending) {
      console.log('[tool:analyze_media] cache MISS — no pending media for this conversation');
      return noPendingMessage();
    }
    console.log(
      `[tool:analyze_media] cache HIT: kind=${pending.kind} bytes=${pending.buffer.length} mime="${pending.mimetype}" dur=${pending.durationSec ?? '-'}s file="${pending.fileName ?? ''}"`,
    );

    // Reality Defender's analysis takes a few seconds (longer for video).
    // Without a progress ping the user sits in silence for >10s while the
    // LLM call + RD round-trip both run. Send a quick WhatsApp message before
    // the RD call so they see something is happening. Failure to send is
    // non-fatal.
    const sendProgress = getProgressSender();
    if (sendProgress) {
      console.log('[tool:analyze_media] → sending progress message');
      sendProgress(progressMessage(pending.kind)).catch((err) =>
        console.warn(`[tool:analyze_media] progress send failed: ${err}`),
      );
    }

    try {
      const t0 = Date.now();
      const verdict = await analyzeMedia(env.REALITY_DEFENDER_API_KEY, {
        buffer: pending.buffer,
        mimetype: pending.mimetype,
        kind: pending.kind,
        fileName: pending.fileName,
      });
      const dt = Date.now() - t0;
      console.log(
        `[tool:analyze_media] ◀ verdict in ${dt}ms: tier=${verdict.tier} score=${verdict.score.toFixed(3)} rawStatus=${verdict.rawStatus} models=${verdict.models.length}`,
      );

      // Persist the structured event for the dashboard. Fire-and-forget — a
      // DB hiccup must not block the user-facing reply. We log warnings on
      // failure so the operator notices a broken write.
      const record = getMediaAnalysisRecorder();
      if (record) {
        record({
          mediaType: pending.kind,
          durationSec: pending.durationSec ?? null,
          fileName: pending.fileName ?? null,
          bytes: pending.buffer.length,
          mimetype: pending.mimetype,
          source: pending.source,
          fromName: pending.fromName || undefined,
          detector: 'reality-defender',
          tier: verdict.tier,
          score: verdict.score,
          rawStatus: verdict.rawStatus,
          modelScores: verdict.models,
          latencyMs: dt,
        }).catch((err) =>
          console.warn(`[tool:analyze_media] media_analyses insert failed: ${err}`),
        );
      } else {
        console.warn('[tool:analyze_media] no recorder in ALS — analysis not persisted');
      }

      return formatVerdict({
        tier: verdict.tier,
        score: verdict.score,
        kind: pending.kind,
        durationSec: pending.durationSec,
        fileName: pending.fileName,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tool:analyze_media] ✗ analysis failed: ${msg}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      return formatErrorForUser(err, pending.kind);
    }
  },
  {
    name: 'analyze_media_deepfake',
    description:
      'Analyzes the media (audio, image, video, or document) that the user most recently shared in this conversation to determine if it is AI-generated / manipulated (deepfake) or authentic. Only call this AFTER the user has explicitly confirmed they want the analysis (e.g., they replied "sí", "dale", "analízalo"). Never call it preemptively on receipt of a media file. Returns a Spanish-language verdict with confidence and next-step recommendations.',
    schema: z.object({}),
  },
);
