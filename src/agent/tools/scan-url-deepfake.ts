import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { getCustomerJid } from '../../utils/request-context.js';
import {
  parallelSearch,
  hostnameOf,
  ParallelKeyMissingError,
} from '../../integrations/parallel-search.js';

// ──────────────────────────────────────────────────────────────────────────────
// Allowlist of video / social platform hostnames
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
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
]);

// ──────────────────────────────────────────────────────────────────────────────
// SSRF guard — blocks private/loopback/link-local ranges
// ──────────────────────────────────────────────────────────────────────────────
function isPrivateHostname(hostname: string): boolean {
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
const RATE_LIMIT_MAX_CALLS = 5;

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

export type SendImageFn = (imageBuffer: Buffer, caption?: string) => Promise<void>;

/**
 * Create the social-media URL scan tool.
 *
 * Instead of downloading the video (yt-dlp) and running pixel-level deepfake
 * detection — which required a system binary and the Python service — this
 * researches the web via the Parallel Search API to report what reliable
 * sources say about the linked content: whether it is AI-generated, a
 * deepfake, manipulated, or has already been debunked.
 *
 * @param _sendImage - accepted for registry compatibility; unused.
 */
export function createScanUrlDeepfakeTool(_sendImage?: SendImageFn) {
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
          'Solo puedo investigar enlaces de plataformas conocidas: ' +
          'YouTube, TikTok, Twitter/X, Instagram o Facebook.'
        );
      }

      // 4. Rate limiting — prefer ambient context phone, fall back to explicit arg.
      const rateLimitKey = `scan_url:${getCustomerJid() ?? callerPhone ?? 'anonymous'}`;
      try {
        checkRateLimit(rateLimitKey);
      } catch (err) {
        return (err as Error).message;
      }

      // 5. Research the link via Parallel Search.
      const host = hostnameOf(url);
      const objective =
        `Investiga el contenido de este enlace de ${host}: ${url}. ` +
        `¿El video o publicación es un deepfake, está generado o manipulado con IA, ` +
        `o ha sido desmentido por verificadores o medios? ` +
        `Resume qué dicen fuentes confiables y si hay señales de desinformación.`;
      const queries = [
        `${url} deepfake`,
        `${url} fake AI generado desmentido`,
        `${host} ${parsed.pathname.replace(/[/_-]+/g, ' ').trim()}`.slice(0, 80),
      ];

      let results;
      try {
        results = await parallelSearch(objective, queries, {
          processor: 'base',
          maxResults: 8,
          maxCharsPerResult: 1200,
        });
      } catch (err) {
        if (err instanceof ParallelKeyMissingError) {
          return 'El buscador no está configurado (falta P_SEARCH). Avísale al administrador del bot.';
        }
        const msg = err instanceof Error ? err.message : String(err);
        return `No pude investigar el enlace en este momento (${msg}). Intenta de nuevo en unos minutos.`;
      }

      if (results.length === 0) {
        return (
          `No encontré información pública sobre ese enlace de ${host}. ` +
          `Eso no significa que sea auténtico — si te lo mandaron pidiendo plata, ` +
          `datos o claves, verifica por otro canal (llamada directa al número que ya conoces).`
        );
      }

      // 6. Hand the evidence to the agent LLM to frame the verdict.
      const findings = results
        .slice(0, 6)
        .map((r, i) => {
          const snippet = (r.excerpts[0] ?? '').replace(/\s+/g, ' ').slice(0, 280);
          const date = r.publishDate ? ` (${r.publishDate})` : '';
          return `${i + 1}. ${r.title} — ${hostnameOf(r.url)}${date}\n   ${snippet}\n   ${r.url}`;
        })
        .join('\n');

      return (
        `Investigué el enlace (${host}) en fuentes web. Esto es lo que encontré ` +
        `— evalúa si indican que el contenido es falso, generado por IA o desmentido, ` +
        `y explícaselo al usuario con tu formato de veredicto:\n\n${findings}`
      );
    },
    {
      name: 'scan_url_deepfake',
      description:
        'Investiga un enlace de YouTube, TikTok, Twitter/X, Instagram o Facebook ' +
        'consultando la web (no descarga el video). Reporta qué dicen fuentes ' +
        'confiables sobre si el contenido es un deepfake, está generado por IA, ' +
        'manipulado o ha sido desmentido. Úsala cuando el usuario envíe un enlace ' +
        'de red social y pregunte si es real, falso o generado por IA.',
      schema: z.object({
        url: z
          .string()
          .describe(
            'URL pública del video/publicación en YouTube, TikTok, Twitter/X, ' +
              'Instagram o Facebook (ej. https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
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

// Default export — registry compatibility (sendImage no longer used).
export const scanUrlDeepfakeTool = createScanUrlDeepfakeTool();
