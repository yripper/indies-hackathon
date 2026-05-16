import { desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { audioAnalyses, conversations } from '../schema';

export type AudioAnalysis = typeof audioAnalyses.$inferSelect;

export type CreateAudioAnalysisInput = {
  conversationId: string;
  agentRunId?: string;

  durationSec: number;
  bytes: number;
  mimetype: string;
  source: 'direct' | 'quoted';
  fromName?: string;

  detector: string;
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  modelScores?: Array<{ name: string; status: string; score: number | null }>;
  latencyMs: number;
};

export const audioAnalysesRepo = {
  async insert(db: Database, input: CreateAudioAnalysisInput): Promise<AudioAnalysis> {
    const [row] = await db
      .insert(audioAnalyses)
      .values({
        conversationId: input.conversationId,
        agentRunId: input.agentRunId,
        durationSec: input.durationSec,
        bytes: input.bytes,
        mimetype: input.mimetype,
        source: input.source,
        fromName: input.fromName,
        detector: input.detector,
        tier: input.tier,
        score: input.score,
        rawStatus: input.rawStatus,
        modelScores: input.modelScores ?? null,
        latencyMs: input.latencyMs,
      })
      .returning();
    return row;
  },

  async recentByConversation(
    db: Database,
    conversationId: string,
    limit = 50,
  ): Promise<AudioAnalysis[]> {
    return db
      .select()
      .from(audioAnalyses)
      .where(eq(audioAnalyses.conversationId, conversationId))
      .orderBy(desc(audioAnalyses.createdAt))
      .limit(limit);
  },

  // Counts grouped by tier over the given window. Used by the dashboard's
  // headline numbers ("47 analyzed today, 12 fake, 30 real, 5 uncertain").
  async countByTier(
    db: Database,
    sinceIsoUtc: string,
  ): Promise<Array<{ tier: string; count: number }>> {
    const rows = await db
      .select({
        tier: audioAnalyses.tier,
        count: sql<number>`count(*)::int`,
      })
      .from(audioAnalyses)
      .where(gte(audioAnalyses.createdAt, new Date(sinceIsoUtc)))
      .groupBy(audioAnalyses.tier);
    return rows;
  },

  async recent(db: Database, limit = 50): Promise<AudioAnalysis[]> {
    return db
      .select()
      .from(audioAnalyses)
      .orderBy(desc(audioAnalyses.createdAt))
      .limit(limit);
  },

  async countSince(db: Database, sinceIsoUtc: string | null): Promise<number> {
    const base = db.select({ n: sql<number>`count(*)::int` }).from(audioAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(audioAnalyses.createdAt, new Date(sinceIsoUtc)))
      : await base;
    return rows[0]?.n ?? 0;
  },

  // Latency percentiles for the detector round-trip over the given window.
  // Uses Postgres percentile_cont (continuous). Returns nulls when the
  // window has no rows; callers should guard.
  async latencyStatsSince(
    db: Database,
    sinceIsoUtc: string,
  ): Promise<{ p50: number | null; p95: number | null; avg: number | null }> {
    const rows = await db
      .select({
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${audioAnalyses.latencyMs})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${audioAnalyses.latencyMs})`,
        avg: sql<number | null>`avg(${audioAnalyses.latencyMs})`,
      })
      .from(audioAnalyses)
      .where(gte(audioAnalyses.createdAt, new Date(sinceIsoUtc)));
    const r = rows[0];
    return {
      p50: r?.p50 != null ? Math.round(Number(r.p50)) : null,
      p95: r?.p95 != null ? Math.round(Number(r.p95)) : null,
      avg: r?.avg != null ? Math.round(Number(r.avg)) : null,
    };
  },

  async countDistinctConversationsSince(
    db: Database,
    sinceIsoUtc: string | null,
  ): Promise<number> {
    const base = db
      .select({ n: sql<number>`count(distinct ${audioAnalyses.conversationId})::int` })
      .from(audioAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(audioAnalyses.createdAt, new Date(sinceIsoUtc)))
      : await base;
    return rows[0]?.n ?? 0;
  },

  // Per-conversation stats: total + tier breakdown + first/last + avg latency.
  // Single round-trip via conditional aggregates.
  async statsByConversation(
    db: Database,
    conversationId: string,
  ): Promise<{
    analysesTotal: number;
    tierCounts: { real: number; uncertain: number; fake: number };
    firstAnalysisAt: Date | null;
    lastAnalysisAt: Date | null;
    avgLatencyMs: number | null;
  }> {
    const rows = await db
      .select({
        analysesTotal: sql<number>`count(*)::int`,
        realCount: sql<number>`count(*) filter (where ${audioAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(*) filter (where ${audioAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(*) filter (where ${audioAnalyses.tier} = 'fake')::int`,
        firstAnalysisAt: sql<Date | null>`min(${audioAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${audioAnalyses.createdAt})`,
        avgLatencyMs: sql<number | null>`avg(${audioAnalyses.latencyMs})`,
      })
      .from(audioAnalyses)
      .where(eq(audioAnalyses.conversationId, conversationId));
    const r = rows[0];
    return {
      analysesTotal: r?.analysesTotal ?? 0,
      tierCounts: {
        real: r?.realCount ?? 0,
        uncertain: r?.uncertainCount ?? 0,
        fake: r?.fakeCount ?? 0,
      },
      firstAnalysisAt: r?.firstAnalysisAt ?? null,
      lastAnalysisAt: r?.lastAnalysisAt ?? null,
      avgLatencyMs: r?.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
    };
  },

  // Conversation list joined with per-conversation aggregates. Ordered by
  // most recent analysis (NULLS LAST so conversations that have never been
  // analyzed still show up at the bottom). Used by the dashboard's family
  // list view.
  async listConversationsWithStats(
    db: Database,
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      customerPhone: string;
      customerName: string | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      analysesTotal: number;
      tierCounts: { real: number; uncertain: number; fake: number };
      firstAnalysisAt: Date | null;
      lastAnalysisAt: Date | null;
    }>
  > {
    const rows = await db
      .select({
        id: conversations.id,
        customerPhone: conversations.customerPhone,
        customerName: conversations.customerName,
        status: conversations.status,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        analysesTotal: sql<number>`count(${audioAnalyses.id})::int`,
        realCount: sql<number>`count(${audioAnalyses.id}) filter (where ${audioAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(${audioAnalyses.id}) filter (where ${audioAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(${audioAnalyses.id}) filter (where ${audioAnalyses.tier} = 'fake')::int`,
        firstAnalysisAt: sql<Date | null>`min(${audioAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${audioAnalyses.createdAt})`,
      })
      .from(conversations)
      .leftJoin(audioAnalyses, eq(audioAnalyses.conversationId, conversations.id))
      .groupBy(conversations.id)
      .orderBy(sql`max(${audioAnalyses.createdAt}) desc nulls last`)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      customerPhone: r.customerPhone,
      customerName: r.customerName,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      analysesTotal: r.analysesTotal,
      tierCounts: { real: r.realCount, uncertain: r.uncertainCount, fake: r.fakeCount },
      firstAnalysisAt: r.firstAnalysisAt,
      lastAnalysisAt: r.lastAnalysisAt,
    }));
  },
};
