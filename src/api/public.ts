import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/connection';
import { publicCasesRepo } from '../db/queries/public-cases';
import { darkwebCampaignsRepo } from '../db/queries/darkweb-campaigns';
import { subscriptionsRepo } from '../db/queries/subscriptions';

export type PublicRoutesOptions = {
  db: Database;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function publicRoutes(
  app: FastifyInstance,
  opts: PublicRoutesOptions,
): Promise<void> {

  app.get('/v1/public/stats', async () => {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS).toISOString();
    const since7d = new Date(now - 7 * DAY_MS).toISOString();

    const [cases24h, cases7d, casesByTier, casesByCountry, topKeywords, campaignsStats] =
      await Promise.all([
        publicCasesRepo.statsSince(opts.db, since24h),
        publicCasesRepo.statsSince(opts.db, since7d),
        publicCasesRepo.countByTier(opts.db),
        publicCasesRepo.countByCountry(opts.db, 20),
        publicCasesRepo.topKeywords(opts.db, 20),
        darkwebCampaignsRepo.statsSince(opts.db, null),
      ]);

    return {
      cases: {
        total_24h: cases24h.total,
        total_7d: cases7d.total,
        by_tier: casesByTier,
        by_country: casesByCountry,
        top_keywords: topKeywords,
      },
      darkweb: {
        total: campaignsStats.total,
        by_country: campaignsStats.byCountry,
        avg_confidence: campaignsStats.avgConfidence,
      },
    };
  });

  app.get('/v1/public/cases', async (req) => {
    const { limit = 50, tier, country, keyword } = req.query as {
      limit?: number;
      tier?: string;
      country?: string;
      keyword?: string;
    };

    let cases;
    if (tier) {
      cases = await publicCasesRepo.byTier(opts.db, tier, limit);
    } else if (country) {
      cases = await publicCasesRepo.byCountry(opts.db, country, limit);
    } else if (keyword) {
      cases = await publicCasesRepo.byKeyword(opts.db, keyword, limit);
    } else {
      cases = await publicCasesRepo.recent(opts.db, limit);
    }

    return { cases };
  });

  app.get('/v1/public/cases/:hash', async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const caseData = await publicCasesRepo.findByHash(opts.db, hash);

    if (!caseData) {
      reply.code(404);
      return { error: 'not_found' };
    }

    return { case: caseData };
  });

  app.get('/v1/public/trends', async () => {
    const [topKeywords, byCountry, darkwebTopics] = await Promise.all([
      publicCasesRepo.topKeywords(opts.db, 20),
      publicCasesRepo.countByCountry(opts.db, 20),
      darkwebCampaignsRepo.topTopics(opts.db, 20),
    ]);

    return {
      keywords: topKeywords,
      countries: byCountry,
      darkweb_topics: darkwebTopics,
    };
  });

  app.get('/v1/public/map', async () => {
    const [casesMap, campaignsMap] = await Promise.all([
      publicCasesRepo.recent(opts.db, 100),
      darkwebCampaignsRepo.mapData(opts.db, 100),
    ]);

    return {
      cases: casesMap
        .filter(c => c.latitude != null && c.longitude != null)
        .map(c => ({
          latitude: c.latitude,
          longitude: c.longitude,
          country: c.country,
          tier: c.tier,
          keywords: c.keywords,
          created_at: c.createdAt,
        })),
      campaigns: campaignsMap,
    };
  });

  app.get('/v1/public/darkweb', async (req) => {
    const { limit = 50, topic, country } = req.query as {
      limit?: number;
      topic?: string;
      country?: string;
    };

    let campaigns;
    if (topic) {
      campaigns = await darkwebCampaignsRepo.byTopic(opts.db, topic, limit);
    } else if (country) {
      campaigns = await darkwebCampaignsRepo.byCountry(opts.db, country, limit);
    } else {
      campaigns = await darkwebCampaignsRepo.recent(opts.db, limit);
    }

    return { campaigns };
  });

  app.post<{ Body: { email: string; topics?: string[]; frequency?: string } }>(
    '/v1/public/subscribe',
    async (req, reply) => {
      const { email, topics = [], frequency = 'daily' } = req.body;

      if (!email || !email.includes('@')) {
        reply.code(400);
        return { error: 'invalid_email' };
      }

      const existing = await subscriptionsRepo.findByEmail(opts.db, email);
      if (existing) {
        if (existing.confirmed) {
          return { message: 'already_subscribed' };
        }
        await subscriptionsRepo.confirm(opts.db, existing.confirmationToken!);
        return { message: 'confirmed' };
      }

      const token = crypto.randomUUID();
      await subscriptionsRepo.insert(opts.db, {
        email,
        topics,
        frequency,
        confirmationToken: token,
      });

      return { message: 'subscribed', confirmation_token: token };
    },
  );

  app.get<{ Params: { token: string } }>(
    '/v1/public/confirm/:token',
    async (req, reply) => {
      const { token } = req.params;
      const sub = await subscriptionsRepo.confirm(opts.db, token);

      if (!sub) {
        reply.code(404);
        return { error: 'invalid_token' };
      }

      return { message: 'confirmed', email: sub.email };
    },
  );

  app.get<{ Params: { email: string } }>(
    '/v1/public/unsubscribe/:email',
    async (req, reply) => {
      const { email } = req.params;
      const sub = await subscriptionsRepo.unsubscribe(opts.db, email);

      if (!sub) {
        reply.code(404);
        return { error: 'not_found' };
      }

      return { message: 'unsubscribed' };
    },
  );
}