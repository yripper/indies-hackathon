/**
 * Parallel Search API integration.
 *
 * One AI-native web-search call replaces the brittle multi-step pipelines we
 * used before (Google Fact Check API + DuckDuckGo HTML scraping for fact-check;
 * yt-dlp download + Python deepfake service for social-media links).
 *
 * Docs: https://docs.parallel.ai/search/search-quickstart
 *   POST https://api.parallel.ai/v1/search
 *   header  x-api-key: $P_SEARCH
 *   body    { objective, search_queries, processor, max_results,
 *             max_chars_per_result }
 *   resp    { results: [{ url, title, publish_date, excerpts: [] }], ... }
 */

const PARALLEL_SEARCH_URL = 'https://api.parallel.ai/v1/search';
const DEFAULT_TIMEOUT_MS = 30_000;

export type ParallelSearchResult = {
  url: string;
  title: string;
  publishDate: string | null;
  excerpts: string[];
};

export type ParallelSearchOptions = {
  /** 'base' (2-5s, cheap) or 'pro' (15-60s, higher quality). Default 'base'. */
  processor?: 'base' | 'pro';
  maxResults?: number;
  maxCharsPerResult?: number;
  timeoutMs?: number;
};

/**
 * Thrown when P_SEARCH is not configured. Callers surface a friendly
 * Spanish-language message to the user instead of a raw stack trace.
 */
export class ParallelKeyMissingError extends Error {
  constructor() {
    super('P_SEARCH is not set');
    this.name = 'ParallelKeyMissingError';
  }
}

type RawResult = {
  url: string;
  title: string;
  publish_date: string | null;
  excerpts?: string[];
};

/**
 * Execute a Parallel web search. `objective` is a natural-language description
 * of what we want to find; `searchQueries` are 2-3 short keyword queries.
 */
export async function parallelSearch(
  objective: string,
  searchQueries: string[],
  opts: ParallelSearchOptions = {},
): Promise<ParallelSearchResult[]> {
  const apiKey = process.env.P_SEARCH ?? '';
  if (!apiKey) throw new ParallelKeyMissingError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(PARALLEL_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      // /v1/search has a strict body schema: only objective + search_queries.
      // (processor / max_results live on /alpha/search and 422 here.)
      body: JSON.stringify({
        objective,
        search_queries: searchQueries.slice(0, 5),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Parallel Search API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const maxResults = opts.maxResults ?? 8;
    const data = (await res.json()) as { results?: RawResult[] };
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      url: r.url,
      title: r.title,
      publishDate: r.publish_date ?? null,
      excerpts: r.excerpts ?? [],
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** Hostname without leading "www." — used as the source/publisher label. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'desconocido';
  }
}
