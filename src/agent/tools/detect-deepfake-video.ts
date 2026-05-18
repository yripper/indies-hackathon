import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';

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

export const detectDeepfakeVideoTool = tool(
  async ({ videoSource }) => {
    const buffer = await fetchVideoBuffer(videoSource);

    const ext = videoSource.split('.').pop()?.toLowerCase() ?? 'mp4';
    const mimeType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
    const filename = `video.${ext}`;

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

    const res = await fetch(`${SERVICE_URL()}/analyze`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Deepfake service error (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      verdict: string;
      confidence: number;
      faces_found: number;
      frames_analyzed: number;
      temporal_inconsistency: number;
      detail: string;
    };

    const pct = Math.round(data.confidence * 100);
    const inconsistency = Math.round(data.temporal_inconsistency * 100);

    return (
      `${data.verdict} (${pct}% de confianza). ` +
      `${data.detail}. ` +
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
