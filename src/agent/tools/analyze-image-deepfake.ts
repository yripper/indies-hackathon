import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { maybeBuildCertificate } from '../../utils/certificate.js';
import { getSendImage } from '../../utils/request-context.js';
import { getCurrentConversationId } from '../context.js';
import { peekPendingImage } from '../../transport/image-cache.js';

const SERVICE_URL = () =>
  (process.env.DEEPFAKE_SERVICE_URL ?? 'http://localhost:8001').replace(/\/$/, '');

function isExplicitSource(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/');
}

async function fetchImageBuffer(imageSource: string): Promise<Buffer> {
  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    const res = await fetch(imageSource);
    if (!res.ok) throw new Error(`Error al descargar imagen (${res.status}): ${imageSource}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(imageSource);
}

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

/**
 * Create the image deepfake analysis tool.
 *
 * @param sendImage - Optional explicit sender.  When omitted the tool falls
 *   back to the ambient AgentRequestContext (see ``src/agent/context.ts``).
 *   Pass an explicit sender in tests.
 */
export function createAnalyzeImageDeepfakeTool(sendImage?: SendImageFn) {
  return tool(
    async ({ imageSource }) => {
      let buffer: Buffer;
      let mimeType = 'image/jpeg';
      let filename = 'image.jpg';

      const convId = getCurrentConversationId();
      const pending = convId ? peekPendingImage(convId) : null;

      if (pending && !isExplicitSource(imageSource)) {
        buffer = pending.buffer;
        mimeType = pending.mimetype || 'image/jpeg';
        const extMatch = mimeType.match(/\/([\w]+)/);
        filename = `image.${extMatch?.[1] ?? 'jpg'}`;
      } else {
        buffer = await fetchImageBuffer(imageSource);
        const ext = imageSource.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
        };
        mimeType = mimeMap[ext] ?? 'image/jpeg';
        filename = `image.${ext}`;
      }

      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

      const res = await fetch(`${SERVICE_URL()}/analyze-image`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Image deepfake service error (${res.status}): ${body}`);
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
          mediaType: 'image',
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
      name: 'analyze_image_deepfake',
      description:
        'Analiza una imagen para detectar si es un deepfake o generada por IA. ' +
        'Úsala cuando el usuario envíe una foto sospechosa o pregunte si una imagen es real o falsa. ' +
        'Si hay una imagen pendiente en la conversación, usa imageSource="pending". ' +
        'También acepta una URL pública (https://) directa.',
      schema: z.object({
        imageSource: z
          .string()
          .describe(
            'Usa "pending" para analizar la imagen pendiente de la conversación, o una URL pública (https://...)',
          ),
      }),
    },
  );
}

// Singleton — sender resolved at call-time from requestContext.
export const analyzeImageDeepfakeTool = createAnalyzeImageDeepfakeTool();
