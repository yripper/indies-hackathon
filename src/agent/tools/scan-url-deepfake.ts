import { execFile } from 'node:child_process';
import { unlink, stat, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { maybeBuildCertificate } from '../../utils/certificate.js';
import { getSendImage, getCustomerJid } from '../../utils/request-context.js';

const execFileAsync = promisify(execFile);

const SERVICE_URL = () =>
  (process.env.DEEPFAKE_SERVICE_URL ?? 'http://localhost:8001').replace(/\/$/, '');

// ──────────────────────────────────────────────────────────────────────────────
// Allowlist of video platform hostnames
// ──────────────────────────────────────────────────────────────────────────────
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
  'instagram.com',
  'www.instagram.com',
]);

// ──────────────────────────────────────────────────────────────────────────────
// SSRF guard — blocks private/loopback/link-local ranges
// ──────────────────────────────────────────────────────────────────────────────
function isPrivateHostname(hostname: string): boolean {
  // Covers: localhost, ::1, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x
  if (/^localhost$/i.test(hostname)) return true;
  if (/^\[?::1\]?$/.test(hostname)) return true;
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-phone rate limiting (in-memory, resets on restart — good enough for MVP)
// ──────────────────────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1_000; // 5 minutes
const RATE_LIMIT_MAX_CALLS = 3;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_CALLS) {
    const remainingMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    const remainingMin = Math.ceil(remainingMs / 60_000);
    throw new Error(
      `Límite de escaneos alcanzado (${RATE_LIMIT_MAX_CALLS} por 5 minutos). ` +
        `Intenta de nuevo en ${remainingMin} minuto${remainingMin !== 1 ? 's' : ''}.`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Download helper
// ──────────────────────────────────────────────────────────────────────────────
const DOWNLOAD_TIMEOUT_MS = 60_000; // 60 s hard cap
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

async function downloadWithYtDlp(url: string): Promise<string> {
  const suffix = randomBytes(6).toString('hex');
  const outPath = `/tmp/yt_${suffix}.mp4`;

  await execFileAsync(
    'yt-dlp',
    [
      '--no-playlist',
      '--max-filesize',
      '100M',
      '--format',
      'best[filesize<100000000]/bestvideo[filesize<100000000]+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '--no-warnings',
      '--quiet',
      '-o',
      outPath,
      url,
    ],
    { timeout: DOWNLOAD_TIMEOUT_MS },
  );

  return outPath;
}

// ──────────────────────────────────────────────────────────────────────────────
// Service response type
// ──────────────────────────────────────────────────────────────────────────────
interface AnalysisResponse {
  verdict: string;
  confidence: number;
  faces_found: number;
  frames_analyzed: number;
  temporal_inconsistency: number;
  detail: string;
}

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

/**
 * Create the URL deepfake scan tool.
 *
 * @param sendImage - Optional explicit sender. When omitted the tool falls
 *   back to the ambient AgentRequestContext (see ``src/agent/context.ts``).
 */
export function createScanUrlDeepfakeTool(sendImage?: SendImageFn) {
  return tool(
    async ({ url, callerPhone }) => {
      // 1. Parse and validate the URL structure.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return 'URL inválida. Por favor envía un enlace completo (ej. https://youtube.com/watch?v=...).';
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return 'Solo se permiten URLs con protocolo http o https.';
      }

      // 2. SSRF guard.
      if (isPrivateHostname(parsed.hostname)) {
        return 'Esa URL apunta a una dirección de red interna y no está permitida.';
      }

      // 3. Platform allowlist.
      if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        return (
          'Solo se permiten videos de plataformas conocidas: ' +
          'YouTube, TikTok, Twitter/X e Instagram.'
        );
      }

      // 4. Rate limiting — prefer ambient context phone, fall back to explicit arg.
      const rateLimitKey = `scan_url:${getCustomerJid() ?? callerPhone ?? 'anonymous'}`;
      try {
        checkRateLimit(rateLimitKey);
      } catch (err) {
        return (err as Error).message;
      }

      // 5. Download.
      let tmpPath: string | null = null;
      try {
        try {
          tmpPath = await downloadWithYtDlp(url);
        } catch (err) {
          const msg = (err as Error).message ?? '';
          if (msg.includes('is not a supported URL') || msg.includes('Unsupported URL')) {
            return 'No se pudo descargar el video: URL no soportada o contenido no disponible.';
          }
          if (msg.includes('Private video') || msg.includes('This video is private')) {
            return 'El video es privado y no se puede analizar.';
          }
          if (msg.includes('has been removed') || msg.includes('no longer available')) {
            return 'El video fue eliminado o no está disponible.';
          }
          if (msg.includes('maximum filesize') || msg.includes('File is larger')) {
            return 'El video supera el límite de 100 MB y no puede analizarse.';
          }
          if (/timed? ?out/i.test(msg) || msg.includes('ETIMEDOUT')) {
            return 'La descarga tardó demasiado (límite: 60 segundos). Intenta con un video más corto.';
          }
          return `Error al descargar el video: ${msg}`;
        }

        // 6. Validate downloaded file size.
        const fileStats = await stat(tmpPath);
        if (fileStats.size > MAX_FILE_SIZE_BYTES) {
          return `El video descargado es demasiado grande (${Math.round(fileStats.size / 1024 / 1024)} MB). Límite: 100 MB.`;
        }

        // 7. Send to deepfake service.
        const buffer = await readFile(tmpPath);
        const form = new FormData();
        form.append(
          'file',
          new Blob([Uint8Array.from(buffer)], { type: 'video/mp4' }),
          'video.mp4',
        );

        const res = await fetch(`${SERVICE_URL()}/analyze`, { method: 'POST', body: form });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Deepfake service error (${res.status}): ${body}`);
        }

        const data = (await res.json()) as AnalysisResponse;
        const pct = Math.round(data.confidence * 100);
        const inconsistency = Math.round(data.temporal_inconsistency * 100);

        const resultText =
          `${data.verdict} (${pct}% de confianza). ` +
          `${data.detail}. ` +
          `Inconsistencia temporal entre frames: ${inconsistency}%.`;

        // 8. Authenticity certificate (only for REAL verdict).
        const effectiveSendImage: SendImageFn | undefined = sendImage ?? getSendImage();
        if (effectiveSendImage) {
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

        return resultText;
      } finally {
        // 9. Always clean up the temp file.
        if (tmpPath) {
          await unlink(tmpPath).catch(() => {
            /* ignore cleanup errors */
          });
        }
      }
    },
    {
      name: 'scan_url_deepfake',
      description:
        'Descarga un video desde una URL pública de YouTube, TikTok, Twitter/X o Instagram ' +
        'y lo analiza para detectar si es un deepfake. ' +
        'Úsala cuando el usuario envíe un enlace de video y pregunte si es real, falso o generado por IA. ' +
        'Límite: videos de hasta 100 MB y descarga máxima de 60 segundos.',
      schema: z.object({
        url: z
          .string()
          .describe(
            'URL pública del video en YouTube, TikTok, Twitter/X o Instagram ' +
              '(ej. https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
          ),
        callerPhone: z
          .string()
          .optional()
          .describe(
            'Número de teléfono del usuario (fallback para rate limiting cuando no hay contexto ambient).',
          ),
      }),
    },
  );
}

// Default export without sendImage — the tool picks up sendImage at runtime
// from the ambient AgentRequestContext populated by handleIncomingMessage.
export const scanUrlDeepfakeTool = createScanUrlDeepfakeTool();
