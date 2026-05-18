import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { darkwebCampaigns } from '../schema';

export type DarkwebCampaign = typeof darkwebCampaigns.$inferSelect;

export const darkwebCampaignsRepo = {
  async insert(db: Database, input: {
    campaignHash: string;
    source: string;
    sourceUrl?: string | null;
    title: string;
    content: string;
    topics?: string[];
    confidence?: number;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    publishedAt?: Date | null;
  }): Promise<DarkwebCampaign> {
    const [row] = await db
      .insert(darkwebCampaigns)
      .values({
        campaignHash: input.campaignHash,
        source: input.source,
        sourceUrl: input.sourceUrl,
        title: input.title,
        content: input.content,
        topics: input.topics ?? [],
        confidence: input.confidence ?? 0.5,
        country: input.country,
        latitude: input.latitude,
        longitude: input.longitude,
        publishedAt: input.publishedAt,
      })
      .returning();
    return row;
  },

  async findByHash(db: Database, campaignHash: string): Promise<DarkwebCampaign | null> {
    const rows = await db
      .select()
      .from(darkwebCampaigns)
      .where(eq(darkwebCampaigns.campaignHash, campaignHash))
      .limit(1);
    return rows[0] ?? null;
  },

  async recent(db: Database, limit = 50): Promise<DarkwebCampaign[]> {
    return db
      .select()
      .from(darkwebCampaigns)
      .orderBy(desc(darkwebCampaigns.detectedAt))
      .limit(limit);
  },

  async byTopic(db: Database, topic: string, limit = 50): Promise<DarkwebCampaign[]> {
    return db
      .select()
      .from(darkwebCampaigns)
      .where(sql`${topic} = ANY(${darkwebCampaigns.topics})`)
      .orderBy(desc(darkwebCampaigns.detectedAt))
      .limit(limit);
  },

  async byCountry(db: Database, country: string, limit = 50): Promise<DarkwebCampaign[]> {
    return db
      .select()
      .from(darkwebCampaigns)
      .where(eq(darkwebCampaigns.country, country))
      .orderBy(desc(darkwebCampaigns.detectedAt))
      .limit(limit);
  },

  async countByCountry(db: Database, limit = 20): Promise<{ country: string; count: number }[]> {
    const rows = await db
      .select({
        country: darkwebCampaigns.country,
        count: sql<number>`count(*)::int`,
      })
      .from(darkwebCampaigns)
      .where(sql`${darkwebCampaigns.country} IS NOT NULL`)
      .groupBy(darkwebCampaigns.country)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows as { country: string; count: number }[];
  },

  async topTopics(db: Database, limit = 20): Promise<{ topic: string; count: number }[]> {
    const rows = await db
      .select({
        topic: sql<string>`unnest(${darkwebCampaigns.topics})`,
        count: sql<number>`count(*)::int`,
      })
      .from(darkwebCampaigns)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows;
  },

  async statsSince(db: Database, sinceIsoUtc: string | null): Promise<{
    total: number;
    byCountry: { country: string; count: number }[];
    byTopic: { topic: string; count: number }[];
    avgConfidence: number | null;
  }> {
    const totalRows = await (sinceIsoUtc
      ? db.select({ n: sql<number>`count(*)::int` }).from(darkwebCampaigns).where(gte(darkwebCampaigns.detectedAt, new Date(sinceIsoUtc)))
      : db.select({ n: sql<number>`count(*)::int` }).from(darkwebCampaigns));

    const countryRows = sinceIsoUtc
      ? await db
          .select({
            country: darkwebCampaigns.country,
            count: sql<number>`count(*)::int`,
          })
          .from(darkwebCampaigns)
          .where(and(
            gte(darkwebCampaigns.detectedAt, new Date(sinceIsoUtc)),
            sql`${darkwebCampaigns.country} IS NOT NULL`
          ))
          .groupBy(darkwebCampaigns.country)
      : await db
          .select({
            country: darkwebCampaigns.country,
            count: sql<number>`count(*)::int`,
          })
          .from(darkwebCampaigns)
          .where(sql`${darkwebCampaigns.country} IS NOT NULL`)
          .groupBy(darkwebCampaigns.country);

    const confidenceRows = sinceIsoUtc
      ? await db
          .select({ avg: sql<number | null>`avg(${darkwebCampaigns.confidence})` })
          .from(darkwebCampaigns)
          .where(gte(darkwebCampaigns.detectedAt, new Date(sinceIsoUtc)))
      : await db
          .select({ avg: sql<number | null>`avg(${darkwebCampaigns.confidence})` })
          .from(darkwebCampaigns);

    return {
      total: totalRows[0]?.n ?? 0,
      byCountry: countryRows as { country: string; count: number }[],
      byTopic: [],
      avgConfidence: confidenceRows[0]?.avg != null ? Number(confidenceRows[0].avg) : null,
    };
  },

  async mapData(db: Database, limit = 100): Promise<{
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    title: string;
    topics: string[];
    confidence: number;
    detectedAt: Date;
  }[]> {
    const rows = await db
      .select({
        latitude: darkwebCampaigns.latitude,
        longitude: darkwebCampaigns.longitude,
        country: darkwebCampaigns.country,
        title: darkwebCampaigns.title,
        topics: darkwebCampaigns.topics,
        confidence: darkwebCampaigns.confidence,
        detectedAt: darkwebCampaigns.detectedAt,
      })
      .from(darkwebCampaigns)
      .where(sql`${darkwebCampaigns.latitude} IS NOT NULL AND ${darkwebCampaigns.longitude} IS NOT NULL`)
      .orderBy(desc(darkwebCampaigns.detectedAt))
      .limit(limit);
    return rows as {
      latitude: number | null;
      longitude: number | null;
      country: string | null;
      title: string;
      topics: string[];
      confidence: number;
      detectedAt: Date;
    }[];
  },
};