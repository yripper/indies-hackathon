// Thin typed client for the Veritas analytics API. Runs server-side from
// Next.js RSCs — no browser cache or CORS concerns at fetch time. We override
// Next's default fetch caching with `cache: 'no-store'` so the dashboard
// always reads fresh DB state during the demo.

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:3000";

export type Tier = "real" | "uncertain" | "fake";

export type TierCounts = {
  real: number;
  uncertain: number;
  fake: number;
};

export type ModelScore = {
  name: string;
  status: string;
  score: number | null;
};

export type MediaType = "audio" | "image";

export type OverviewResponse = {
  totals: {
    analyses_all_time: number;
    analyses_24h: number;
    analyses_7d: number;
    conversations_with_audio: number;
    conversations_with_image?: number;
    audio_all_time?: number;
    audio_24h?: number;
    audio_7d?: number;
    image_all_time?: number;
    image_24h?: number;
    image_7d?: number;
  };
  tier_breakdown_24h: TierCounts;
  tier_breakdown_7d: TierCounts;
  audio_tier_breakdown_24h?: TierCounts;
  audio_tier_breakdown_7d?: TierCounts;
  image_tier_breakdown_24h?: TierCounts;
  image_tier_breakdown_7d?: TierCounts;
  latency_ms: {
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  image_latency_ms?: {
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  recent: Array<{
    id: string;
    conversation_id: string;
    tier: Tier;
    score: number;
    duration_sec: number | null;
    bytes?: number;
    from_name: string | null;
    mimetype: string;
    source: "direct" | "quoted";
    detector: string;
    latency_ms: number;
    created_at: string;
    media_type?: MediaType;
  }>;
};

export type ConversationsListResponse = {
  conversations: Array<{
    id: string;
    customer_phone: string;
    customer_name: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    analyses_total: number;
    tier_counts: TierCounts;
    first_analysis_at: string | null;
    last_analysis_at: string | null;
  }>;
};

export type ConversationDetailResponse = {
  conversation: {
    id: string;
    customer_phone: string;
    customer_name: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  stats: {
    analyses_total: number;
    tier_counts: TierCounts;
    first_analysis_at: string | null;
    last_analysis_at: string | null;
    avg_latency_ms: number | null;
  };
  analyses: Array<{
    id: string;
    tier: Tier;
    score: number;
    raw_status: string;
    duration_sec: number | null;
    bytes: number;
    mimetype: string;
    source: "direct" | "quoted";
    from_name: string | null;
    detector: string;
    model_scores: ModelScore[] | null;
    latency_ms: number;
    agent_run_id: string | null;
    created_at: string;
    media_type?: MediaType;
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

export function getOverview() {
  return getJson<OverviewResponse>("/v1/analytics/overview");
}

export function getConversations() {
  return getJson<ConversationsListResponse>("/v1/analytics/conversations");
}

export function getConversation(id: string) {
  return getJson<ConversationDetailResponse>(
    `/v1/analytics/conversations/${encodeURIComponent(id)}`,
  );
}
