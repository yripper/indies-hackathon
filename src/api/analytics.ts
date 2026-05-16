import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/connection';
import { audioAnalysesRepo } from '../db/queries/audio-analyses';
import { imageAnalysesRepo } from '../db/queries/image-analyses';
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

function mergeTierCounts(
  a: { real: number; uncertain: number; fake: number },
  b: { real: number; uncertain: number; fake: number },
): { real: number; uncertain: number; fake: number } {
  return {
    real: a.real + b.real,
    uncertain: a.uncertain + b.uncertain,
    fake: a.fake + b.fake,
  };
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
      audioAllTime,
      audio24h,
      audio7d,
      audioTier24hRows,
      audioTier7dRows,
      audioLatencyStats,
      conversationsWithAudio,
      audioRecent,
      imageAllTime,
      image24h,
      image7d,
      imageTier24hRows,
      imageTier7dRows,
      imageLatencyStats,
      conversationsWithImage,
      imageRecent,
    ] = await Promise.all([
      audioAnalysesRepo.countSince(opts.db, null),
      audioAnalysesRepo.countSince(opts.db, since24h),
      audioAnalysesRepo.countSince(opts.db, since7d),
      audioAnalysesRepo.countByTier(opts.db, since24h),
      audioAnalysesRepo.countByTier(opts.db, since7d),
      audioAnalysesRepo.latencyStatsSince(opts.db, since7d),
      audioAnalysesRepo.countDistinctConversationsSince(opts.db, null),
      audioAnalysesRepo.recent(opts.db, 20),
      imageAnalysesRepo.countSince(opts.db, null),
      imageAnalysesRepo.countSince(opts.db, since24h),
      imageAnalysesRepo.countSince(opts.db, since7d),
      imageAnalysesRepo.countByTier(opts.db, since24h),
      imageAnalysesRepo.countByTier(opts.db, since7d),
      imageAnalysesRepo.latencyStatsSince(opts.db, since7d),
      imageAnalysesRepo.countDistinctConversationsSince(opts.db, null),
      imageAnalysesRepo.recent(opts.db, 20),
    ]);

    const audioTier24h = fillTierCounts(audioTier24hRows);
    const audioTier7d = fillTierCounts(audioTier7dRows);
    const imageTier24h = fillTierCounts(imageTier24hRows);
    const imageTier7d = fillTierCounts(imageTier7dRows);

    // Merge recent from both sources, sorted by created_at desc, limited to 20
    const mergedRecent = [
      ...audioRecent.map((r) => ({
        id: r.id,
        conversation_id: r.conversationId,
        tier: r.tier,
        score: r.score,
        duration_sec: r.durationSec,
        bytes: r.bytes,
        from_name: r.fromName,
        mimetype: r.mimetype,
        source: r.source,
        detector: r.detector,
        latency_ms: r.latencyMs,
        created_at: r.createdAt,
        media_type: 'audio' as const,
      })),
      ...imageRecent.map((r) => ({
        id: r.id,
        conversation_id: r.conversationId,
        tier: r.tier,
        score: r.score,
        duration_sec: null as number | null,
        bytes: r.bytes,
        from_name: r.fromName,
        mimetype: r.mimetype,
        source: r.source,
        detector: r.detector,
        latency_ms: r.latencyMs,
        created_at: r.createdAt,
        media_type: 'image' as const,
      })),
    ]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    return {
      totals: {
        analyses_all_time: audioAllTime + imageAllTime,
        analyses_24h: audio24h + image24h,
        analyses_7d: audio7d + image7d,
        conversations_with_audio: conversationsWithAudio,
        conversations_with_image: conversationsWithImage,
        // Audio-specific (backward compat)
        audio_all_time: audioAllTime,
        audio_24h: audio24h,
        audio_7d: audio7d,
        // Image-specific
        image_all_time: imageAllTime,
        image_24h: image24h,
        image_7d: image7d,
      },
      // Combined tier breakdown (backward compatible)
      tier_breakdown_24h: mergeTierCounts(audioTier24h, imageTier24h),
      tier_breakdown_7d: mergeTierCounts(audioTier7d, imageTier7d),
      // Per-media-type breakdowns
      audio_tier_breakdown_24h: audioTier24h,
      audio_tier_breakdown_7d: audioTier7d,
      image_tier_breakdown_24h: imageTier24h,
      image_tier_breakdown_7d: imageTier7d,
      latency_ms: audioLatencyStats,
      image_latency_ms: imageLatencyStats,
      recent: mergedRecent,
    };
  });

  // Image-specific overview endpoint
  app.get('/v1/analytics/overview/image', async () => {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS).toISOString();
    const since7d = new Date(now - 7 * DAY_MS).toISOString();

    const [allTime, count24h, count7d, tier24hRows, tier7dRows, latencyStats, convCount, recent] =
      await Promise.all([
        imageAnalysesRepo.countSince(opts.db, null),
        imageAnalysesRepo.countSince(opts.db, since24h),
        imageAnalysesRepo.countSince(opts.db, since7d),
        imageAnalysesRepo.countByTier(opts.db, since24h),
        imageAnalysesRepo.countByTier(opts.db, since7d),
        imageAnalysesRepo.latencyStatsSince(opts.db, since7d),
        imageAnalysesRepo.countDistinctConversationsSince(opts.db, null),
        imageAnalysesRepo.recent(opts.db, 20),
      ]);

    return {
      totals: {
        analyses_all_time: allTime,
        analyses_24h: count24h,
        analyses_7d: count7d,
        conversations_with_image: convCount,
      },
      tier_breakdown_24h: fillTierCounts(tier24hRows),
      tier_breakdown_7d: fillTierCounts(tier7dRows),
      latency_ms: latencyStats,
      recent: recent.map((r) => ({
        id: r.id,
        conversation_id: r.conversationId,
        tier: r.tier,
        score: r.score,
        bytes: r.bytes,
        from_name: r.fromName,
        mimetype: r.mimetype,
        source: r.source,
        detector: r.detector,
        latency_ms: r.latencyMs,
        created_at: r.createdAt,
        media_type: 'image' as const,
      })),
    };
  });

  // Family-list view: every conversation with its aggregate audio-analysis
  // stats. Ordered most-recently-active first.
  app.get('/v1/analytics/conversations', async () => {
    const rows = await audioAnalysesRepo.listConversationsWithStats(opts.db, 100);
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

      const [audioStats, audioAnalyses, imageStats, imageAnalysesList] = await Promise.all([
        audioAnalysesRepo.statsByConversation(opts.db, conversation.id),
        audioAnalysesRepo.recentByConversation(opts.db, conversation.id, 50),
        imageAnalysesRepo.statsByConversation(opts.db, conversation.id),
        imageAnalysesRepo.recentByConversation(opts.db, conversation.id, 50),
      ]);

      const combinedStats = {
        analyses_total: audioStats.analysesTotal + imageStats.analysesTotal,
        tier_counts: mergeTierCounts(audioStats.tierCounts, imageStats.tierCounts),
        first_analysis_at:
          audioStats.firstAnalysisAt && imageStats.firstAnalysisAt
            ? audioStats.firstAnalysisAt < imageStats.firstAnalysisAt
              ? audioStats.firstAnalysisAt
              : imageStats.firstAnalysisAt
            : audioStats.firstAnalysisAt ?? imageStats.firstAnalysisAt,
        last_analysis_at:
          audioStats.lastAnalysisAt && imageStats.lastAnalysisAt
            ? audioStats.lastAnalysisAt > imageStats.lastAnalysisAt
              ? audioStats.lastAnalysisAt
              : imageStats.lastAnalysisAt
            : audioStats.lastAnalysisAt ?? imageStats.lastAnalysisAt,
        avg_latency_ms:
          audioStats.avgLatencyMs != null && imageStats.avgLatencyMs != null
            ? Math.round((audioStats.avgLatencyMs + imageStats.avgLatencyMs) / 2)
            : audioStats.avgLatencyMs ?? imageStats.avgLatencyMs,
      };

      // Merge analyses from both media types, sorted by created_at desc
      const mergedAnalyses = [
        ...audioAnalyses.map((a) => ({
          id: a.id,
          tier: a.tier,
          score: a.score,
          raw_status: a.rawStatus,
          duration_sec: a.durationSec,
          bytes: a.bytes,
          mimetype: a.mimetype,
          source: a.source,
          from_name: a.fromName,
          detector: a.detector,
          model_scores: a.modelScores,
          latency_ms: a.latencyMs,
          agent_run_id: a.agentRunId,
          created_at: a.createdAt,
          media_type: 'audio' as const,
        })),
        ...imageAnalysesList.map((a) => ({
          id: a.id,
          tier: a.tier,
          score: a.score,
          raw_status: a.rawStatus,
          duration_sec: null as number | null,
          bytes: a.bytes,
          mimetype: a.mimetype,
          source: a.source,
          from_name: a.fromName,
          detector: a.detector,
          model_scores: a.modelScores,
          latency_ms: a.latencyMs,
          agent_run_id: a.agentRunId,
          created_at: a.createdAt,
          media_type: 'image' as const,
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);

      return {
        conversation: {
          id: conversation.id,
          customer_phone: conversation.customerPhone,
          customer_name: conversation.customerName,
          status: conversation.status,
          created_at: conversation.createdAt,
          updated_at: conversation.updatedAt,
        },
        stats: combinedStats,
        analyses: mergedAnalyses,
      };
    },
  );
}
