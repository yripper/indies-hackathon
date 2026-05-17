import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { maybeBuildCertificate } from '../../utils/certificate.js';
import { getSendImage } from '../../utils/request-context.js';

const SERVICE_URL = () =>
  (process.env.DEEPFAKE_SERVICE_URL ?? 'http://localhost:8001').replace(/\/$/, '');

async function fetchAudioBuffer(audioSource: string): Promise<Buffer> {
  if (audioSource.startsWith('http://') || audioSource.startsWith('https://')) {
    const res = await fetch(audioSource);
    if (!res.ok) throw new Error(`Error al descargar audio (${res.status}): ${audioSource}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(audioSource);
}

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

/**
 * Create the audio deepfake analysis tool.
 *
 * @param sendImage - Optional explicit sender.  When omitted the tool falls
 *   back to the ambient AgentRequestContext (see ``src/agent/context.ts``).
 *   Pass an explicit sender in tests.
 */
export function createAnalyzeAudioDeepfakeTool(sendImage?: SendImageFn) {
  return tool(
    async ({ audioSource }) => {
      const buffer = await fetchAudioBuffer(audioSource);

      const ext = audioSource.split('.').pop()?.toLowerCase() ?? 'wav';
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        opus: 'audio/ogg',
      };
      const mimeType = mimeMap[ext] ?? 'audio/wav';
      const filename = `audio.${ext}`;

      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

      const res = await fetch(`${SERVICE_URL()}/analyze-audio`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Audio deepfake service error (${res.status}): ${body}`);
      }

      const data = (await res.json()) as {
        verdict: string;
        confidence: number;
        detail: string;
      };

      const pct = Math.round(data.confidence * 100);

      // Resolve the image sender: explicit factory arg > ambient request context.
      const effectiveSendImage: SendImageFn | undefined = sendImage ?? getSendImage();

      if (effectiveSendImage) {
        const cert = await maybeBuildCertificate({
          mediaType: 'audio',
          mediaBuffer: buffer,
          confidence: data.confidence,
          verdict: data.verdict,
        });
        if (cert) {
          await effectiveSendImage(cert, '🛡️ Veritas Authenticity Certificate');
        }
      }

      return `${data.verdict} (${pct}% de confianza). ${data.detail}.`;
    },
    {
      name: 'analyze_audio_deepfake',
      description:
        'Analiza un archivo de audio para detectar si es un deepfake o voz generada por IA. ' +
        'Úsala cuando el usuario envíe un audio sospechoso o pregunte si una voz es real o sintética. ' +
        'Acepta una URL pública (https://) o una ruta local al archivo (/tmp/audio.ogg).',
      schema: z.object({
        audioSource: z
          .string()
          .describe(
            'URL pública del audio (https://...) o ruta local al archivo (/tmp/wa_audio_xxx.ogg)',
          ),
      }),
    },
  );
}

// Singleton — sender resolved at call-time from requestContext.
export const analyzeAudioDeepfakeTool = createAnalyzeAudioDeepfakeTool();
