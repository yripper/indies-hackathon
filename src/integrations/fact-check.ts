/**
 * Fact-check integration backed by the Parallel Search API.
 *
 * Replaces the previous Google Fact Check API + DuckDuckGo HTML-scrape
 * pipeline (Google needed a key that was never set; the DDG fallback broke
 * when DuckDuckGo changed its markup / bot-blocked us, so the tool always
 * returned "no verificable"). Parallel is a single reliable call.
 */

import { parallelSearch, hostnameOf, ParallelKeyMissingError } from './parallel-search.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types (unchanged — fact-check-claim.ts depends on this shape)
// ─────────────────────────────────────────────────────────────────────────────

export type FactCheckSource = {
  publisher: string;
  title: string;
  url: string;
  rating: string;
};

export type FactCheckResult = {
  verdict: 'true' | 'false' | 'misleading' | 'unverifiable';
  confidence: number; // 0–1
  sources: FactCheckSource[];
  summary: string; // one-line explanation
};

// Re-exported so the tool layer can surface a friendly key-missing message.
export { ParallelKeyMissingError };

// ─────────────────────────────────────────────────────────────────────────────
// Verdict inference from result text
// ─────────────────────────────────────────────────────────────────────────────

/** Infer a weak rating from a snippet of title/excerpt text. */
function inferRatingFromText(text: string): string {
  const t = text.toLowerCase();
  if (
    /\b(falso|false|fake|hoax|mentira|desinformaci[oó]n|enga[ñn]o|bulo|fabricad[oa]|no es (cierto|verdad)|desmentid[oa])\b/.test(
      t,
    )
  )
    return 'Falso';
  if (
    /\b(enga[ñn]oso|misleading|parcialmente|half.?true|fuera de contexto|exagerad[oa]|sin contexto)\b/.test(
      t,
    )
  )
    return 'Engañoso';
  if (/\b(verdader[oa]|true|real|correct[oa]|verificad[oa]|confirmad[oa]|es cierto)\b/.test(t))
    return 'Verdadero';
  return 'No verificado';
}

function ratingToVerdict(rating: string): FactCheckResult['verdict'] {
  const r = rating.toLowerCase();
  if (/\b(true|verdadero|correcto|correct|real|accurate|cierto|confirmad)\b/.test(r)) return 'true';
  if (/\b(false|falso|incorrect|incorrecto|wrong|fake|mentira|hoax|bulo|desmentid)\b/.test(r))
    return 'false';
  if (/\b(mislead|enga[ñn]|half[- ]?true|partly|parcial|distort|exaggerat|out of context|fuera de contexto)\b/.test(r))
    return 'misleading';
  return 'unverifiable';
}

/** Average the verdicts from several sources into a single result. */
function aggregateVerdicts(sources: FactCheckSource[]): {
  verdict: FactCheckResult['verdict'];
  confidence: number;
} {
  const rated = sources.filter((s) => ratingToVerdict(s.rating) !== 'unverifiable');
  if (rated.length === 0) {
    // We still found sources, but none carried a clear signal — leave the
    // final call to the agent LLM, which sees the source list.
    return { verdict: 'unverifiable', confidence: sources.length > 0 ? 0.3 : 0 };
  }

  const scores: Record<FactCheckResult['verdict'], number> = {
    true: 0,
    false: 0,
    misleading: 0,
    unverifiable: 0,
  };
  for (const s of rated) scores[ratingToVerdict(s.rating)] += 1;

  const dominant = (Object.entries(scores) as [FactCheckResult['verdict'], number][]).reduce(
    (a, b) => (b[1] > a[1] ? b : a),
  );

  const confidence = Math.min(0.95, 0.5 + (dominant[1] / rated.length) * 0.45);
  return { verdict: dominant[0], confidence };
}

function buildSummary(
  verdict: FactCheckResult['verdict'],
  sources: FactCheckSource[],
): string {
  const label: Record<FactCheckResult['verdict'], string> = {
    true: 'verdadera',
    false: 'falsa',
    misleading: 'engañosa o parcialmente incorrecta',
    unverifiable: 'no concluyente con las fuentes disponibles',
  };

  if (sources.length === 0) {
    return 'No se encontraron fuentes relevantes para esta afirmación.';
  }

  const top = sources
    .slice(0, 2)
    .map((s) => s.publisher)
    .join(' y ');

  if (verdict === 'unverifiable') {
    return `Encontré fuentes relacionadas (${top}) pero no son concluyentes; revisa el detalle abajo.`;
  }
  return `Según ${top} y otras fuentes consultadas, la afirmación parece ${label[verdict]}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function factCheck(claim: string): Promise<FactCheckResult> {
  const trimmed = claim.trim();

  const objective =
    `Verifica si la siguiente afirmación es verdadera, falsa o engañosa. ` +
    `Prioriza organizaciones de fact-checking y medios confiables. ` +
    `Indica explícitamente si ha sido desmentida o confirmada. Afirmación: "${trimmed}"`;

  const queries = [
    trimmed.slice(0, 80),
    `${trimmed.slice(0, 60)} fact check`,
    `${trimmed.slice(0, 60)} verificación falso`,
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
      return {
        verdict: 'unverifiable',
        confidence: 0,
        sources: [],
        summary:
          'El verificador de noticias no está configurado (falta P_SEARCH). ' +
          'Avísale al administrador del bot.',
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verdict: 'unverifiable',
      confidence: 0,
      sources: [],
      summary: `No se pudo consultar fuentes en este momento (${msg}).`,
    };
  }

  const sources: FactCheckSource[] = results.map((r) => ({
    publisher: hostnameOf(r.url),
    title: r.title,
    url: r.url,
    rating: inferRatingFromText(`${r.title} ${r.excerpts.join(' ')}`),
  }));

  const { verdict, confidence } = aggregateVerdicts(sources);
  const summary = buildSummary(verdict, sources);

  return { verdict, confidence, sources, summary };
}
