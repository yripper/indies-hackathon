import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { factCheck } from '../../integrations/fact-check.js';

// ─────────────────────────────────────────────────────────────────────────────
// Per-phone rate limiting (in-memory, resets on restart)
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1_000; // 5 minutes
const RATE_LIMIT_MAX_CALLS = 5; // more generous than video since it's a lightweight API

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
      `Límite de verificaciones alcanzado (${RATE_LIMIT_MAX_CALLS} por 5 minutos). ` +
        `Intenta de nuevo en ${remainingMin} minuto${remainingMin !== 1 ? 's' : ''}.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT_EMOJI: Record<string, string> = {
  true: '✅ Verdadero',
  false: '❌ Falso',
  misleading: '⚠️ Engañoso',
  unverifiable: '❓ No verificable',
};

function formatResult(
  verdict: string,
  confidence: number,
  sources: Array<{ publisher: string; title: string; url: string; rating: string }>,
  summary: string,
): string {
  const pct = Math.round(confidence * 100);
  const label = VERDICT_EMOJI[verdict] ?? '❓ No verificable';

  const lines: string[] = [
    `*${label}* (${pct}% de confianza)`,
    '',
    summary,
  ];

  if (sources.length > 0) {
    lines.push('', '*Fuentes consultadas:*');
    for (const src of sources.slice(0, 5)) {
      lines.push(`• *${src.publisher}* — ${src.rating}`);
      lines.push(`  ${src.title}`);
      lines.push(`  ${src.url}`);
    }
  } else {
    lines.push('', '_No se encontraron fuentes de verificación para esta afirmación._');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const verificarNoticiaTool = tool(
  async ({ claim, callerPhone }) => {
    // Rate limiting
    const key = `verificar_noticia:${callerPhone ?? 'anonymous'}`;
    try {
      checkRateLimit(key);
    } catch (err) {
      return (err as Error).message;
    }

    let result;
    try {
      result = await factCheck(claim);
    } catch (err) {
      const msg = (err as Error).message ?? 'Error desconocido';
      return `No se pudo verificar la afirmación en este momento: ${msg}`;
    }

    return formatResult(result.verdict, result.confidence, result.sources, result.summary);
  },
  {
    name: 'verificar_noticia',
    description:
      'Verifica si una afirmación o noticia es verdadera consultando bases de datos de ' +
      'fact-checking y fuentes confiables. Úsala cuando el usuario envíe un texto que parezca ' +
      'una noticia dudosa, una afirmación sospechosa o pida comprobar si algo es real.',
    schema: z.object({
      claim: z
        .string()
        .describe(
          'La afirmación, titular o texto de la noticia que se quiere verificar. ' +
            'Debe ser el contenido a verificar, no una pregunta.',
        ),
      callerPhone: z
        .string()
        .optional()
        .describe('Número de teléfono del usuario (usado internamente para rate limiting).'),
    }),
  },
);
