const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3000";

export type Tier = "real" | "uncertain" | "fake";

export type PublicStatsResponse = {
  cases: {
    total_24h: number;
    total_7d: number;
    by_tier: Array<{ tier: string; count: number }>;
    by_country: Array<{ country: string; count: number }>;
    top_keywords: Array<{ keyword: string; count: number }>;
  };
  darkweb: {
    total: number;
    by_country: Array<{ country: string; count: number }>;
    avg_confidence: number | null;
  };
};

export type PublicCase = {
  id: string;
  case_hash: string;
  media_type: string;
  tier: string;
  score: number;
  summary: string;
  sources: string[];
  keywords: string[];
  country: string | null;
  region: string | null;
  thumbnail_url: string | null;
  external_url: string | null;
  created_at: string;
};

export type PublicCasesResponse = {
  cases: PublicCase[];
};

export type PublicTrendsResponse = {
  keywords: Array<{ keyword: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  darkweb_topics: Array<{ topic: string; count: number }>;
};

export type MapDataResponse = {
  cases: Array<{
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    tier: string;
    keywords: string[];
    created_at: string;
  }>;
  campaigns: Array<{
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    title: string;
    topics: string[];
    confidence: number;
    detected_at: string;
  }>;
};

async function getJson<T>(path: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getPublicStats() {
  return getJson<PublicStatsResponse>("/v1/public/stats");
}

export function getPublicCases(params?: { limit?: number; tier?: string; country?: string; keyword?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.tier) searchParams.set('tier', params.tier);
  if (params?.country) searchParams.set('country', params.country);
  if (params?.keyword) searchParams.set('keyword', params.keyword);
  const query = searchParams.toString();
  return getJson<PublicCasesResponse>(`/v1/public/cases${query ? `?${query}` : ""}`);
}

export function getPublicTrends() {
  return getJson<PublicTrendsResponse>("/v1/public/trends");
}

export function getMapData() {
  return getJson<MapDataResponse>("/v1/public/map");
}

export async function subscribeEmail(email: string, topics: string[] = [], frequency = 'daily') {
  const res = await fetch(`${API_BASE_URL}/v1/public/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, topics, frequency }),
  });
  return res.json();
}