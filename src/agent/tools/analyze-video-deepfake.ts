import { readFile, unlink } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { logger } from '../../config/logger';
import { getCurrentConversationId, getProgressSender } from '../context';
import { takePendingVideo } from '../../transport/video-cache';

const log = logger.child({ tool: 'analyze_video' });

const SERVICE_URL = (): string =>
  (process.env.DEEPFAKE_SERVICE_URL ?? 'http://localhost:7860').replace(/\/$/, '');

type Tier = 'real' | 'uncertain' | 'fake';

// The Python service already classifies into REAL/UNCERTAIN/FAKE internally
// (its own confidence thresholds at 0.4 and 0.8). Trust that classification
// — re-thresholding here would double-count and risk mismatch if the service
// retunes. The confidence number stays for display.
function tierFromVerdict(verdict: string): Tier {
  if (verdict === 'FAKE') return 'fake';
  if (verdict === 'UNCERTAIN') return 'uncertain';
  return 'real';
}

type ServiceResponse = {
  verdict: string;
  confidence: number;
  faces_found: number;
  frames_analyzed: number;
  temporal_inconsistency: number;
  // Optional — heavier detectors may include a human-readable detail string;
  // the lightweight OpenCV-based detector currently omits it.
  detail?: string;
};

export const analyzeVideoDeepfakeTool = tool(
  async (): Promise<string> => {
    log.info('tool invoked');
    const jid = getCurrentConversationId();
    if (!jid) {
      log.warn('no conversation key in AsyncLocalStorage');
      return 'Error interno: no pude identificar la conversación. Reenviame el video.';
    }

    const pending = takePendingVideo(jid);
    if (!pending) {
      log.info('cache MISS — no pending video');
      return 'No encuentro un video reciente para analizar. Reenviámelo y pedime el análisis de nuevo.';
    }
    log.info({ bytes: pending.bytes, mime: pending.mimetype, source: pending.source }, 'cache HIT');

    const sendProgress = getProgressSender();
    if (sendProgress) {
      sendProgress(
        '🎥 Analizando video frame por frame con el detector de deepfakes... esto puede tardar 20-40s.',
      ).catch((err) => log.warn({ err }, 'progress send failed'));
    }

    const t0 = Date.now();
    let buffer: Buffer;
    try {
      buffer = await readFile(pending.filePath);
    } catch (err) {
      log.error({ err, filePath: pending.filePath }, 'video read failed');
      return 'No pude leer el video del cache. Reenviámelo.';
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: pending.mimetype }),
      'video.mp4',
    );

    let data: ServiceResponse;
    try {
      const res = await fetch(`${SERVICE_URL()}/analyze`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        log.error({ status: res.status, body }, 'service returned non-200');
        return `El detector de video respondió con un error (${res.status}). Probá de nuevo en un momento.`;
      }
      data = (await res.json()) as ServiceResponse;
    } catch (err) {
      log.error({ err, url: SERVICE_URL() }, 'service unreachable');
      return (
        'No pude contactar al servicio de detección de video. Probá de nuevo en un ' +
        'momento — si seguís viendo este error, levantá el servicio con ' +
        '`docker compose --profile ml up deepfake`.'
      );
    } finally {
      unlink(pending.filePath).catch(() => {});
    }

    const tier = tierFromVerdict(data.verdict);
    const pct = Math.round(data.confidence * 100);
    const inc = Math.round(data.temporal_inconsistency * 100);
    log.info(
      { tier, verdict: data.verdict, confidence: data.confidence, totalMs: Date.now() - t0 },
      'verdict computed',
    );

    const detalle =
      `\n\nDetalle técnico:\n` +
      `• Veredicto del modelo: ${data.verdict} (${pct}% confianza)\n` +
      `• Frames analizados: ${data.frames_analyzed} — rostros detectados: ${data.faces_found}\n` +
      `• Inconsistencia temporal entre frames: ${inc}%`;

    if (tier === 'fake') {
      return (
        `RESULTADO: este video tiene fuertes señales de ser un deepfake ` +
        `(confianza ${pct}%).\n\n` +
        `Recomendación: no confíes en este video como prueba. Si te lo mandaron ` +
        `pidiéndote plata, datos personales o algo urgente, verificá por otro canal ` +
        `— una videollamada en vivo con la persona, o llamala al número que ya conocés.` +
        detalle
      );
    }
    if (tier === 'uncertain') {
      return (
        `RESULTADO: el detector no se pone de acuerdo sobre este video ` +
        `(zona gris, ${pct}% confianza).\n\n` +
        `Recomendación: no asumas que es real ni que es falso. Verificá por otro canal ` +
        `— una videollamada en vivo es lo más seguro.` +
        detalle
      );
    }
    return (
      `RESULTADO: este video parece auténtico (señal de deepfake baja, ${pct}%).\n\n` +
      `Igual te recomiendo: si el video te pide plata, una clave o algo urgente, ` +
      `verificá por otro canal antes de actuar. Los detectores no son perfectos.` +
      detalle
    );
  },
  {
    name: 'analyze_video_deepfake',
    description:
      'Analiza el video que el usuario mandó más recientemente en esta conversación ' +
      'para detectar si es un deepfake. Examina múltiples frames, detecta rostros con ' +
      'MTCNN y evalúa artefactos temporales (parpadeo, jitter, lip sync). Llamala solo ' +
      'cuando el usuario haya confirmado explícitamente que quiere el análisis, o cuando ' +
      'mande un video con una pregunta clara como "¿es real?" o "¿es deepfake?". ' +
      'Devuelve un veredicto en español.',
    schema: z.object({}),
  },
);
