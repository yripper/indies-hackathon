/**
 * Fact-check integration: queries the Google Fact Check Tools API with a
 * DuckDuckGo HTML search as fallback when no existing fact-checks are found.
 */

const FACTCHECK_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Abort controller with a fixed timeout. */
function withTimeout(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller;
}

/** Map a raw rating string from the API to one of our four verdicts. */
function ratingToVerdict(rating: string): FactCheckResult['verdict'] {
  const r = rating.toLowerCase();

  if (/\b(true|verdadero|correcto|correct|real|accurate|cierto)\b/.test(r)) return 'true';

  if (
    /\b(false|falso|incorrect|incorrecto|wrong|fake|mentira|fabricated|fabricado|hoax|fals[ao])\b/.test(
      r,
    )
  )
    return 'false';

  if (
    /\b(mislead|engañ|half[- ]?true|partly|parcial|distort|exaggerat|manipulat|out of context|fuera de contexto)\b/.test(
      r,
    )
  )
    return 'misleading';

  return 'unverifiable';
}

/** Average the verdicts from several sources into a single result. */
function aggregateVerdicts(sources: FactCheckSource[]): {
  verdict: FactCheckResult['verdict'];
  confidence: number;
} {
  if (sources.length === 0) return { verdict: 'unverifiable', confidence: 0 };

  const verdictScores: Record<FactCheckResult['verdict'], number> = {
    true: 0,
    false: 0,
    misleading: 0,
    unverifiable: 0,
  };

  for (const s of sources) {
    verdictScores[ratingToVerdict(s.rating)] += 1;
  }

  const dominant = (Object.entries(verdictScores) as [FactCheckResult['verdict'], number][]).reduce(
    (a, b) => (b[1] > a[1] ? b : a),
  );

  const confidence = Math.min(0.95, 0.5 + (dominant[1] / sources.length) * 0.45);

  return { verdict: dominant[0], confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Fact Check Tools API
// ─────────────────────────────────────────────────────────────────────────────

type GoogleClaimReview = {
  url: string;
  title?: string;
  reviewDate?: string;
  textualRating: string;
  languageCode?: string;
  publisher: {
    name: string;
    site?: string;
  };
};

type GoogleClaim = {
  text: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: GoogleClaimReview[];
};

type GoogleFactCheckResponse = {
  claims?: GoogleClaim[];
};

async function queryGoogleFactCheck(claim: string): Promise<FactCheckSource[]> {
  const apiKey = process.env.GOOGLE_FACTCHECK_API_KEY ?? '';
  const params = new URLSearchParams({ query: claim, languageCode: 'es', pageSize: '10' });
  if (apiKey) params.set('key', apiKey);

  const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?${params.toString()}`;

  const controller = withTimeout(FACTCHECK_TIMEOUT_MS);
  const res = await fetch(url, { signal: controller.signal });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Fact Check API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as GoogleFactCheckResponse;

  if (!data.claims || data.claims.length === 0) return [];

  const sources: FactCheckSource[] = [];

  for (const item of data.claims) {
    for (const review of item.claimReview ?? []) {
      sources.push({
        publisher: review.publisher.name,
        title: review.title ?? item.text,
        url: review.url,
        rating: review.textualRating,
      });
    }
  }

  return sources;
}

// ─────────────────────────────────────────────────────────────────────────────
// DuckDuckGo HTML fallback
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DDG_RESULTS = 5;

/** Very lightweight HTML parser — no external deps required. */
function parseDdgResults(html: string): FactCheckSource[] {
  const sources: FactCheckSource[] = [];

  // DuckDuckGo wraps each result in <div class="result__body">…</div>
  // We extract href from <a class="result__a"> and the snippet from <a class="result__snippet">
  const resultPattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null && sources.length < MAX_DDG_RESULTS) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const snippet = match[3].replace(/<[^>]+>/g, '').trim();

    // DuckDuckGo wraps URLs in redirect — extract uddg param if present
    let finalUrl = rawUrl;
    try {
      const u = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
      const uddg = u.searchParams.get('uddg');
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      // keep rawUrl
    }

    if (!title || !finalUrl) continue;

    sources.push({
      publisher: (() => {
        try {
          return new URL(finalUrl).hostname.replace(/^www\./, '');
        } catch {
          return 'Desconocido';
        }
      })(),
      title,
      url: finalUrl,
      // Infer a weak rating from the snippet text
      rating: inferRatingFromText(snippet + ' ' + title),
    });
  }

  return sources;
}

function inferRatingFromText(text: string): string {
  const t = text.toLowerCase();
  if (/\b(falso|false|fake|hoax|mentira|desinformación)\b/.test(t)) return 'Falso';
  if (/\b(verdadero|true|real|correcto|verificado)\b/.test(t)) return 'Verdadero';
  if (/\b(engañoso|misleading|parcialmente|half.?true|exagerado)\b/.test(t)) return 'Engañoso';
  return 'No verificado';
}

async function searchDuckDuckGo(claim: string): Promise<FactCheckSource[]> {
  const query = encodeURIComponent(`${claim} fact check verificación`);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  const controller = withTimeout(FACTCHECK_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FactCheckBot/1.0)',
      'Accept-Language': 'es,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo search error (${res.status})`);
  }

  const html = await res.text();
  return parseDdgResults(html);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSummary(
  verdict: FactCheckResult['verdict'],
  sources: FactCheckSource[],
  usedFallback: boolean,
): string {
  const verdictLabel: Record<FactCheckResult['verdict'], string> = {
    true: 'verdadera',
    false: 'falsa',
    misleading: 'engañosa o parcialmente incorrecta',
    unverifiable: 'no verificable con las fuentes disponibles',
  };

  const label = verdictLabel[verdict];

  if (sources.length === 0) {
    return `No se encontraron verificaciones previas de esta afirmación.`;
  }

  const sourceList = sources
    .slice(0, 2)
    .map((s) => s.publisher)
    .join(' y ');

  if (usedFallback) {
    return `Según resultados de búsqueda (${sourceList}), la afirmación parece ${label}.`;
  }

  return `Según ${sourceList} y otras fuentes de fact-checking, la afirmación es ${label}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function factCheck(claim: string): Promise<FactCheckResult> {
  let sources: FactCheckSource[] = [];
  let usedFallback = false;

  // 1. Try Google Fact Check API first
  try {
    sources = await queryGoogleFactCheck(claim);
  } catch (err) {
    // Log but don't surface — we'll try the fallback
    console.warn('[fact-check] Google API failed:', (err as Error).message);
  }

  // 2. If no results, fall back to DuckDuckGo web search
  if (sources.length === 0) {
    usedFallback = true;
    try {
      sources = await searchDuckDuckGo(claim);
    } catch (err) {
      console.warn('[fact-check] DuckDuckGo fallback failed:', (err as Error).message);
    }
  }

  const { verdict, confidence } = aggregateVerdicts(sources);
  const summary = buildSummary(verdict, sources, usedFallback);

  return { verdict, confidence, sources, summary };
}
