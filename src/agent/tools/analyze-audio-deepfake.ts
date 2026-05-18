import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import {
  getAudioAnalysisRecorder,
  getCurrentConversationId,
  getProgressSender,
} from '../context';
import { takePendingAudio } from '../../transport/audio-cache';
import { analyzeAudio, QuotaExhaustedError } from '../../integrations/reality-defender';
import { checkRateLimit, recordAnalysis } from '../../rate-limit/analysis-limiter';

const log = logger.child({ tool: 'analyze_audio' });

// Tool returns prose for the LLM to embed in its reply. The three-tier framing
// rule lives here (not in the system prompt) because it depends on the numeric
// score returned by the detector — keeping it in code prevents the LLM from
// "softening" the verdict on its own.
function formatVerdict(tier: 'real' | 'uncertain' | 'fake', score: number, durationSec: number): string {
  const pct = Math.round(score * 100);
  const dur = durationSec > 0 ? `${durationSec}s` : 'audio recibido';
  if (tier === 'fake') {
    return [
      `RESULTADO: este ${dur} tiene fuertes señales de ser generado por IA (confianza ${pct}%).`,
      `Recomendación: NO confíes en este audio. Si alguien te pidió plata, una clave o información sensible, contactá a esa persona por otro canal (llamada directa al número conocido, mensaje a otro familiar) antes de hacer nada. Si ya transferiste, llamá al banco ahora.`,
    ].join('\n\n');
  }
  if (tier === 'uncertain') {
    return [
      `RESULTADO: el detector no está seguro (señal ${pct}%, zona gris).`,
      `Recomendación: no asumas que es real ni que es falso. Verificá el contenido por otro canal — llamá directamente al número de la persona o pedile que te mande otro mensaje con una palabra acordada de antemano (clave familiar).`,
    ].join('\n\n');
  }
  return [
    `RESULTADO: este ${dur} parece auténtico (señal de IA ${pct}%, baja).`,
    `Igual te recomiendo: si el audio te pide plata, una clave o algo urgente, verificá por otro canal antes de actuar. Los detectores no son perfectos.`,
  ].join('\n\n');
}

export const analyzeAudioDeepfakeTool = tool(
  async () => {
    log.info('tool invoked');
    // ALS stores the WhatsApp JID (customerPhone), which is the same key the
    // audio cache uses. The variable is named "conversationId" historically
    // but it's the JID, not the DB UUID.
    const convKey = getCurrentConversationId();
    if (!convKey) {
      log.warn('no conversation key in AsyncLocalStorage — bailing');
      return 'Error interno: no pude identificar la conversación. Reenviame el audio de nuevo.';
    }
    log.info({ jid: convKey }, 'resolved conversation key');

    const pending = takePendingAudio(convKey);
    if (!pending) {
      log.info('cache MISS — no pending audio for this conversation');
      return 'No encuentro un audio reciente para analizar. Reenviame el audio (o respondé al audio mencionándome) y volvé a pedirme análisis.';
    }
    log.info(
      { bytes: pending.buffer.length, mime: pending.mimetype, durationSec: pending.durationSec },
      'cache HIT',
    );

    // Per-JID rate limit — protect the shared 50 scans/month quota
    const rateCheck = checkRateLimit(convKey);
    if (!rateCheck.allowed) {
      const mins = Math.ceil((rateCheck.retryAfterSec ?? 60) / 60);
      log.warn({ jid: convKey, retryAfterSec: rateCheck.retryAfterSec }, 'rate limited');
      return `Has alcanzado el límite de análisis por hora (5/hora). Intentá de nuevo en ${mins} minutos.`;
    }

    // Reality Defender's audio detection takes ~7-10s. Without a progress
    // ping the user sits in silence for >10s while the LLM call + RD round-
    // trip both run. Send a quick WhatsApp message before the RD call so
    // they see something is happening. Failure to send is non-fatal.
    const sendProgress = getProgressSender();
    if (sendProgress) {
      log.info('sending progress message');
      sendProgress('🔍 Analizando el audio... dame unos segundos.').catch(
        (err) => log.warn({ err }, 'progress send failed'),
      );
    }

    try {
      const t0 = Date.now();
      const verdict = await analyzeAudio(env.REALITY_DEFENDER_API_KEY, {
        buffer: pending.buffer,
        mimetype: pending.mimetype,
      });
      const dt = Date.now() - t0;
      log.info(
        { latencyMs: dt, tier: verdict.tier, score: verdict.score, rawStatus: verdict.rawStatus, models: verdict.models.length },
        'verdict received',
      );

      // Persist the structured event for the dashboard. Fire-and-forget — a
      // DB hiccup must not block the user-facing reply. We log warnings on
      // failure so the operator notices a broken write.
      const record = getAudioAnalysisRecorder();
      if (record) {
        record({
          durationSec: pending.durationSec,
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
          log.warn({ err }, 'audio_analyses insert failed'),
        );
      } else {
        log.warn('no recorder in ALS — analysis not persisted');
      }

      recordAnalysis(convKey);
      return formatVerdict(verdict.tier, verdict.score, pending.durationSec);
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        log.warn({ err }, 'quota exhausted');
        return 'Se acabó la cuota mensual del detector de audio (50 análisis gratis por mes). El servicio se renueva el primer día del próximo mes. Mientras tanto, no puedo analizar audios — si es urgente, pedile a alguien de confianza que escuche el audio y te confirme si reconoce la voz.';
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'RD call failed');
      return `Error al analizar el audio: ${msg}. Intentá de nuevo en unos minutos.`;
    }
  },
  {
    name: 'analyze_audio_deepfake',
    description:
      'Analyzes the audio that the user most recently shared in this conversation to determine if it is AI-generated (deepfake) or authentic. Only call this AFTER the user has explicitly confirmed they want the analysis (e.g., they replied "sí", "dale", "analízalo"). Never call it preemptively on receipt of an audio. Returns a Spanish-language verdict with confidence and next-step recommendations.',
    schema: z.object({}),
  },
);
