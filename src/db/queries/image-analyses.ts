import { desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { imageAnalyses, conversations } from '../schema';

export type ImageAnalysis = typeof imageAnalyses.$inferSelect;

export type CreateImageAnalysisInput = {
  conversationId: string;
  agentRunId?: string;
  bytes: number;
  mimetype: string;
  source: 'direct' | 'quoted';
  fromName?: string;
  detector: string;
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  modelScores?: Array<{ name: string; status: string; score: number | null }>;
  secondaryDetector?: {
    provider: 'sightengine';
    aiGenerated: number;
    deepfake: number | null;
    generators: Record<string, number>;
    requestId: string;
    error?: string;
  } | null;
  latencyMs: number;
};

export const imageAnalysesRepo = {
  async insert(db: Database, input: CreateImageAnalysisInput): Promise<ImageAnalysis> {
    const [row] = await db
      .insert(imageAnalyses)
      .values({
        conversationId: input.conversationId,
        agentRunId: input.agentRunId,
        bytes: input.bytes,
        mimetype: input.mimetype,
        source: input.source,
        fromName: input.fromName,
        detector: input.detector,
        tier: input.tier,
        score: input.score,
        rawStatus: input.rawStatus,
        modelScores: input.modelScores ?? null,
        secondaryDetector: input.secondaryDetector ?? null,
        latencyMs: input.latencyMs,
      })
      .returning();
    return row;
  },

  async recentByConversation(
    db: Database,
    conversationId: string,
    limit = 50,
  ): Promise<ImageAnalysis[]> {
    return db
      .select()
      .from(imageAnalyses)
      .where(eq(imageAnalyses.conversationId, conversationId))
      .orderBy(desc(imageAnalyses.createdAt))
      .limit(limit);
  },

  async countByTier(
    db: Database,
    sinceIsoUtc: string,
  ): Promise<Array<{ tier: string; count: number }>> {
    const rows = await db
      .select({
        tier: imageAnalyses.tier,
        count: sql<number>`count(*)::int`,
      })
      .from(imageAnalyses)
      .where(gte(imageAnalyses.createdAt, new Date(sinceIsoUtc)))
      .groupBy(imageAnalyses.tier);
    return rows;
  },

  async recent(db: Database, limit = 50): Promise<ImageAnalysis[]> {
    return db
      .select()
      .from(imageAnalyses)
      .orderBy(desc(imageAnalyses.createdAt))
      .limit(limit);
  },

  async countSince(db: Database, sinceIsoUtc: string | null): Promise<number> {
    const base = db.select({ n: sql<number>`count(*)::int` }).from(imageAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(imageAnalyses.createdAt, new Date(sinceIsoUtc)))
      : await base;
    return rows[0]?.n ?? 0;
  },

  async latencyStatsSince(
    db: Database,
    sinceIsoUtc: string,
  ): Promise<{ p50: number | null; p95: number | null; avg: number | null }> {
    const rows = await db
      .select({
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${imageAnalyses.latencyMs})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${imageAnalyses.latencyMs})`,
        avg: sql<number | null>`avg(${imageAnalyses.latencyMs})`,
      })
      .from(imageAnalyses)
      .where(gte(imageAnalyses.createdAt, new Date(sinceIsoUtc)));
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
      .select({ n: sql<number>`count(distinct ${imageAnalyses.conversationId})::int` })
      .from(imageAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(imageAnalyses.createdAt, new Date(sinceIsoUtc)))
      : await base;
    return rows[0]?.n ?? 0;
  },

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
        realCount: sql<number>`count(*) filter (where ${imageAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(*) filter (where ${imageAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(*) filter (where ${imageAnalyses.tier} = 'fake')::int`,
        firstAnalysisAt: sql<Date | null>`min(${imageAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${imageAnalyses.createdAt})`,
        avgLatencyMs: sql<number | null>`avg(${imageAnalyses.latencyMs})`,
      })
      .from(imageAnalyses)
      .where(eq(imageAnalyses.conversationId, conversationId));
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
        analysesTotal: sql<number>`count(${imageAnalyses.id})::int`,
        realCount: sql<number>`count(${imageAnalyses.id}) filter (where ${imageAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(${imageAnalyses.id}) filter (where ${imageAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(${imageAnalyses.id}) filter (where ${imageAnalyses.tier} = 'fake')::int`,
        firstAnalysisAt: sql<Date | null>`min(${imageAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${imageAnalyses.createdAt})`,
      })
      .from(conversations)
      .leftJoin(imageAnalyses, eq(imageAnalyses.conversationId, conversations.id))
      .groupBy(conversations.id)
      .orderBy(sql`max(${imageAnalyses.createdAt}) desc nulls last`)
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
