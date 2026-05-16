import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/connection';
import { mediaAnalysesRepo } from '../db/queries/media-analyses';
import { conversationsRepo } from '../db/queries/conversations';

export type AnalyticsRoutesOptions = {
  db: Database;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Normalize a tier-count list (from countByTier, which omits tiers with zero
// rows) into a fully-populated record so the dashboard can render fixed
// columns without null-checking every cell.
function fillTierCounts(rows: Array<{ tier: string; count: number }>): {
  real: number;
  uncertain: number;
  fake: number;
} {
  const acc = { real: 0, uncertain: 0, fake: 0 };
  for (const r of rows) {
    if (r.tier === 'real' || r.tier === 'uncertain' || r.tier === 'fake') {
      acc[r.tier] = r.count;
    }
  }
  return acc;
}

// Same normalization for media-type counts. Lets the dashboard render four
// fixed columns even when a window only has rows of one or two kinds.
function fillMediaTypeCounts(rows: Array<{ mediaType: string; count: number }>): {
  audio: number;
  image: number;
  video: number;
  document: number;
} {
  const acc = { audio: 0, image: 0, video: 0, document: 0 };
  for (const r of rows) {
    if (r.mediaType === 'audio' || r.mediaType === 'image' || r.mediaType === 'video' || r.mediaType === 'document') {
      acc[r.mediaType] = r.count;
    }
  }
  return acc;
}

export async function analyticsRoutes(
  app: FastifyInstance,
  opts: AnalyticsRoutesOptions,
): Promise<void> {
  // Headline numbers for the top-level dashboard view.
  app.get('/v1/analytics/overview', async () => {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS).toISOString();
    const since7d = new Date(now - 7 * DAY_MS).toISOString();

    const [
      analysesAllTime,
      analyses24h,
      analyses7d,
      tier24hRows,
      tier7dRows,
      mediaType24hRows,
      mediaType7dRows,
      latencyStats,
      conversationsWithMedia,
      recent,
    ] = await Promise.all([
      mediaAnalysesRepo.countSince(opts.db, null),
      mediaAnalysesRepo.countSince(opts.db, since24h),
      mediaAnalysesRepo.countSince(opts.db, since7d),
      mediaAnalysesRepo.countByTier(opts.db, since24h),
      mediaAnalysesRepo.countByTier(opts.db, since7d),
      mediaAnalysesRepo.countByMediaType(opts.db, since24h),
      mediaAnalysesRepo.countByMediaType(opts.db, since7d),
      mediaAnalysesRepo.latencyStatsSince(opts.db, since7d),
      mediaAnalysesRepo.countDistinctConversationsSince(opts.db, null),
      mediaAnalysesRepo.recent(opts.db, 20),
    ]);

    return {
      totals: {
        analyses_all_time: analysesAllTime,
        analyses_24h: analyses24h,
        analyses_7d: analyses7d,
        conversations_with_media: conversationsWithMedia,
      },
      tier_breakdown_24h: fillTierCounts(tier24hRows),
      tier_breakdown_7d: fillTierCounts(tier7dRows),
      media_type_breakdown_24h: fillMediaTypeCounts(mediaType24hRows),
      media_type_breakdown_7d: fillMediaTypeCounts(mediaType7dRows),
      latency_ms: latencyStats,
      recent: recent.map((r) => ({
        id: r.id,
        conversation_id: r.conversationId,
        media_type: r.mediaType,
        tier: r.tier,
        score: r.score,
        duration_sec: r.durationSec,
        file_name: r.fileName,
        from_name: r.fromName,
        mimetype: r.mimetype,
        source: r.source,
        detector: r.detector,
        latency_ms: r.latencyMs,
        created_at: r.createdAt,
      })),
    };
  });

  // Family-list view: every conversation with its aggregate media-analysis
  // stats. Ordered most-recently-active first.
  app.get('/v1/analytics/conversations', async () => {
    const rows = await mediaAnalysesRepo.listConversationsWithStats(opts.db, 100);
    return {
      conversations: rows.map((r) => ({
        id: r.id,
        customer_phone: r.customerPhone,
        customer_name: r.customerName,
        status: r.status,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        analyses_total: r.analysesTotal,
        tier_counts: r.tierCounts,
        media_type_counts: r.mediaTypeCounts,
        first_analysis_at: r.firstAnalysisAt,
        last_analysis_at: r.lastAnalysisAt,
      })),
    };
  });

  // Per-conversation drill-down: conversation metadata + stats + last 50
  // detection events with full model breakdown.
  app.get<{ Params: { id: string } }>(
    '/v1/analytics/conversations/:id',
    async (req, reply) => {
      const conversation = await conversationsRepo.findById(opts.db, req.params.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'not_found' };
      }

      const [stats, analyses] = await Promise.all([
        mediaAnalysesRepo.statsByConversation(opts.db, conversation.id),
        mediaAnalysesRepo.recentByConversation(opts.db, conversation.id, 50),
      ]);

      return {
        conversation: {
          id: conversation.id,
          customer_phone: conversation.customerPhone,
          customer_name: conversation.customerName,
          status: conversation.status,
          created_at: conversation.createdAt,
          updated_at: conversation.updatedAt,
        },
        stats: {
          analyses_total: stats.analysesTotal,
          tier_counts: stats.tierCounts,
          media_type_counts: stats.mediaTypeCounts,
          first_analysis_at: stats.firstAnalysisAt,
          last_analysis_at: stats.lastAnalysisAt,
          avg_latency_ms: stats.avgLatencyMs,
        },
        analyses: analyses.map((a) => ({
          id: a.id,
          media_type: a.mediaType,
          tier: a.tier,
          score: a.score,
          raw_status: a.rawStatus,
          duration_sec: a.durationSec,
          file_name: a.fileName,
          bytes: a.bytes,
          mimetype: a.mimetype,
          source: a.source,
          from_name: a.fromName,
          detector: a.detector,
          model_scores: a.modelScores,
          latency_ms: a.latencyMs,
          agent_run_id: a.agentRunId,
          created_at: a.createdAt,
        })),
      };
    },
  );
}
