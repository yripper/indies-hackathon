import { desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { mediaAnalyses, conversations } from '../schema';

export type MediaAnalysis = typeof mediaAnalyses.$inferSelect;

export type MediaType = 'audio' | 'image' | 'video' | 'document';

export type CreateMediaAnalysisInput = {
  conversationId: string;
  agentRunId?: string;

  mediaType: MediaType;
  // Audio/video only. Images and documents leave this null.
  durationSec?: number | null;
  // Documents carry an original filename; other types usually don't.
  fileName?: string | null;
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

export const mediaAnalysesRepo = {
  async insert(db: Database, input: CreateMediaAnalysisInput): Promise<MediaAnalysis> {
    const [row] = await db
      .insert(mediaAnalyses)
      .values({
        conversationId: input.conversationId,
        agentRunId: input.agentRunId,
        mediaType: input.mediaType,
        durationSec: input.durationSec ?? null,
        fileName: input.fileName ?? null,
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
  ): Promise<MediaAnalysis[]> {
    return db
      .select()
      .from(mediaAnalyses)
      .where(eq(mediaAnalyses.conversationId, conversationId))
      .orderBy(desc(mediaAnalyses.createdAt))
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
        tier: mediaAnalyses.tier,
        count: sql<number>`count(*)::int`,
      })
      .from(mediaAnalyses)
      .where(gte(mediaAnalyses.createdAt, new Date(sinceIsoUtc)))
      .groupBy(mediaAnalyses.tier);
    return rows;
  },

  // Counts grouped by media_type over the given window. Lets the dashboard
  // show "12 audios, 8 images, 3 videos" alongside the tier breakdown.
  async countByMediaType(
    db: Database,
    sinceIsoUtc: string,
  ): Promise<Array<{ mediaType: string; count: number }>> {
    const rows = await db
      .select({
        mediaType: mediaAnalyses.mediaType,
        count: sql<number>`count(*)::int`,
      })
      .from(mediaAnalyses)
      .where(gte(mediaAnalyses.createdAt, new Date(sinceIsoUtc)))
      .groupBy(mediaAnalyses.mediaType);
    return rows;
  },

  async recent(db: Database, limit = 50): Promise<MediaAnalysis[]> {
    return db
      .select()
      .from(mediaAnalyses)
      .orderBy(desc(mediaAnalyses.createdAt))
      .limit(limit);
  },

  async countSince(db: Database, sinceIsoUtc: string | null): Promise<number> {
    const base = db.select({ n: sql<number>`count(*)::int` }).from(mediaAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(mediaAnalyses.createdAt, new Date(sinceIsoUtc)))
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
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${mediaAnalyses.latencyMs})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${mediaAnalyses.latencyMs})`,
        avg: sql<number | null>`avg(${mediaAnalyses.latencyMs})`,
      })
      .from(mediaAnalyses)
      .where(gte(mediaAnalyses.createdAt, new Date(sinceIsoUtc)));
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
      .select({ n: sql<number>`count(distinct ${mediaAnalyses.conversationId})::int` })
      .from(mediaAnalyses);
    const rows = sinceIsoUtc
      ? await base.where(gte(mediaAnalyses.createdAt, new Date(sinceIsoUtc)))
      : await base;
    return rows[0]?.n ?? 0;
  },

  // Per-conversation stats: total + tier breakdown + media-type breakdown +
  // first/last + avg latency. Single round-trip via conditional aggregates.
  async statsByConversation(
    db: Database,
    conversationId: string,
  ): Promise<{
    analysesTotal: number;
    tierCounts: { real: number; uncertain: number; fake: number };
    mediaTypeCounts: { audio: number; image: number; video: number; document: number };
    firstAnalysisAt: Date | null;
    lastAnalysisAt: Date | null;
    avgLatencyMs: number | null;
  }> {
    const rows = await db
      .select({
        analysesTotal: sql<number>`count(*)::int`,
        realCount: sql<number>`count(*) filter (where ${mediaAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(*) filter (where ${mediaAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(*) filter (where ${mediaAnalyses.tier} = 'fake')::int`,
        audioCount: sql<number>`count(*) filter (where ${mediaAnalyses.mediaType} = 'audio')::int`,
        imageCount: sql<number>`count(*) filter (where ${mediaAnalyses.mediaType} = 'image')::int`,
        videoCount: sql<number>`count(*) filter (where ${mediaAnalyses.mediaType} = 'video')::int`,
        documentCount: sql<number>`count(*) filter (where ${mediaAnalyses.mediaType} = 'document')::int`,
        firstAnalysisAt: sql<Date | null>`min(${mediaAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${mediaAnalyses.createdAt})`,
        avgLatencyMs: sql<number | null>`avg(${mediaAnalyses.latencyMs})`,
      })
      .from(mediaAnalyses)
      .where(eq(mediaAnalyses.conversationId, conversationId));
    const r = rows[0];
    return {
      analysesTotal: r?.analysesTotal ?? 0,
      tierCounts: {
        real: r?.realCount ?? 0,
        uncertain: r?.uncertainCount ?? 0,
        fake: r?.fakeCount ?? 0,
      },
      mediaTypeCounts: {
        audio: r?.audioCount ?? 0,
        image: r?.imageCount ?? 0,
        video: r?.videoCount ?? 0,
        document: r?.documentCount ?? 0,
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
      mediaTypeCounts: { audio: number; image: number; video: number; document: number };
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
        analysesTotal: sql<number>`count(${mediaAnalyses.id})::int`,
        realCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.tier} = 'real')::int`,
        uncertainCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.tier} = 'uncertain')::int`,
        fakeCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.tier} = 'fake')::int`,
        audioCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.mediaType} = 'audio')::int`,
        imageCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.mediaType} = 'image')::int`,
        videoCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.mediaType} = 'video')::int`,
        documentCount: sql<number>`count(${mediaAnalyses.id}) filter (where ${mediaAnalyses.mediaType} = 'document')::int`,
        firstAnalysisAt: sql<Date | null>`min(${mediaAnalyses.createdAt})`,
        lastAnalysisAt: sql<Date | null>`max(${mediaAnalyses.createdAt})`,
      })
      .from(conversations)
      .leftJoin(mediaAnalyses, eq(mediaAnalyses.conversationId, conversations.id))
      .groupBy(conversations.id)
      .orderBy(sql`max(${mediaAnalyses.createdAt}) desc nulls last`)
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
      mediaTypeCounts: {
        audio: r.audioCount,
        image: r.imageCount,
        video: r.videoCount,
        document: r.documentCount,
      },
      firstAnalysisAt: r.firstAnalysisAt,
      lastAnalysisAt: r.lastAnalysisAt,
    }));
  },
};
