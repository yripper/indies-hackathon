import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { maybeBuildCertificate } from '../../utils/certificate.js';
import { getSendImage, type SendImageFn } from '../../utils/request-context.js';

const SERVICE_URL = () =>
  (process.env.DEEPFAKE_SERVICE_URL ?? 'http://localhost:8001').replace(/\/$/, '');

async function fetchVideoBuffer(videoSource: string): Promise<Buffer> {
  if (videoSource.startsWith('http://') || videoSource.startsWith('https://')) {
    const res = await fetch(videoSource);
    if (!res.ok) throw new Error(`Error al descargar video (${res.status}): ${videoSource}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(videoSource);
}

export type { SendImageFn };

/**
 * Service response from POST /analyze-visual.
 * The regular /analyze response is a strict subset (no heatmap_b64).
 */
interface AnalysisResult {
  verdict: string;
  confidence: number;
  faces_found: number;
  frames_analyzed: number;
  temporal_inconsistency: number;
  frame_scores?: number[];
  heatmap_b64?: string;
  detail?: string;
}

/**
 * Create the deepfake video detection tool.
 *
 * @param sendImage - Optional explicit sender used in tests.  In production the
 *   tool resolves the sender at call-time from the ambient AgentRequestContext
 *   (populated by ``handleIncomingMessage``), so the tool instance can be a
 *   singleton even though it sends to different recipients per conversation.
 */
export function createDetectDeepfakeVideoTool(sendImage?: SendImageFn) {
  return tool(
    async ({ videoSource }) => {
      const buffer = await fetchVideoBuffer(videoSource);

      const ext = videoSource.split('.').pop()?.toLowerCase() ?? 'mp4';
      const mimeType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const filename = `video.${ext}`;

      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

      // Use /analyze-visual to get heatmap alongside the verdict in one request.
      const res = await fetch(`${SERVICE_URL()}/analyze-visual`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Deepfake service error (${res.status}): ${body}`);
      }

      const data = (await res.json()) as AnalysisResult;

      // Resolve the image sender: explicit factory arg > ambient request context.
      const effectiveSendImage: SendImageFn | undefined = sendImage ?? getSendImage();

      if (effectiveSendImage) {
        // --- Heatmap: always send when the service returns one ---
        if (data.heatmap_b64) {
          const pngBuffer = Buffer.from(data.heatmap_b64, 'base64');
          const verdictEmoji =
            data.verdict === 'FAKE' ? '🚨' : data.verdict === 'UNCERTAIN' ? '⚠️' : '✅';
          const pct = Math.round(data.confidence * 100);
          const caption =
            `${verdictEmoji} Veritas — Frame Analysis\n` +
            `Veredicto: ${data.verdict} (${pct}% confianza)\n` +
            `Frames analizados: ${data.frames_analyzed}`;

          // Non-blocking — heatmap delivery is best-effort so a transient image-
          // send failure never delays or breaks the agent's text reply.
          effectiveSendImage(pngBuffer, caption).catch((err: unknown) => {
            console.error('[detect-deepfake-video] Failed to send heatmap:', err);
          });
        }

        // --- Authenticity certificate: only for REAL verdict ---
        const cert = await maybeBuildCertificate({
          mediaType: 'video',
          mediaBuffer: buffer,
          confidence: data.confidence,
          verdict: data.verdict,
        });
        if (cert) {
          await effectiveSendImage(cert, '🛡️ Veritas Authenticity Certificate');
        }
      }

      const pct = Math.round(data.confidence * 100);
      const inconsistency = Math.round(data.temporal_inconsistency * 100);

      return (
        `${data.verdict} (${pct}% de confianza). ` +
        (data.detail ? `${data.detail}. ` : '') +
        `Inconsistencia temporal entre frames: ${inconsistency}%.`
      );
    },
    {
      name: 'detect_deepfake_video',
      description:
        'Analiza un video para detectar si es un deepfake. Examina múltiples frames, detecta ' +
        'rostros con MTCNN y evalúa artefactos temporales (parpadeo, jitter, lip sync). ' +
        'Úsala cuando el usuario pida analizar un video sospechoso o pregunte si un video es falso o generado por IA. ' +
        'Acepta una URL pública (https://) o una ruta local al archivo (/tmp/video.mp4).',
      schema: z.object({
        videoSource: z
          .string()
          .describe(
            'URL pública del video (https://...) o ruta local al archivo (/tmp/wa_video_xxx.mp4)',
          ),
      }),
    },
  );
}

// Singleton tool — the sender is resolved at call-time from requestContext,
// so this single instance correctly routes images to each conversation's recipient.
export const detectDeepfakeVideoTool = createDetectDeepfakeVideoTool();
