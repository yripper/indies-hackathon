import { desc, eq, gte, sql, and, inArray } from 'drizzle-orm';
import type { Database } from '../connection';
import { publicCases, sourceTraces } from '../schema';

export type PublicCase = typeof publicCases.$inferSelect;

export const publicCasesRepo = {
  async insert(db: Database, input: {
    caseHash: string;
    mediaType: string;
    tier: string;
    score: number;
    summary: string;
    sources?: string[];
    keywords?: string[];
    latitude?: number | null;
    longitude?: number | null;
    country?: string | null;
    region?: string | null;
    thumbnailUrl?: string | null;
    externalUrl?: string | null;
  }): Promise<PublicCase> {
    const [row] = await db
      .insert(publicCases)
      .values({
        caseHash: input.caseHash,
        mediaType: input.mediaType,
        tier: input.tier,
        score: input.score,
        summary: input.summary,
        sources: input.sources ?? [],
        keywords: input.keywords ?? [],
        latitude: input.latitude,
        longitude: input.longitude,
        country: input.country,
        region: input.region,
        thumbnailUrl: input.thumbnailUrl,
        externalUrl: input.externalUrl,
      })
      .returning();
    return row;
  },

  async findByHash(db: Database, caseHash: string): Promise<PublicCase | null> {
    const rows = await db
      .select()
      .from(publicCases)
      .where(eq(publicCases.caseHash, caseHash))
      .limit(1);
    return rows[0] ?? null;
  },

  async recent(db: Database, limit = 50): Promise<PublicCase[]> {
    return db
      .select()
      .from(publicCases)
      .orderBy(desc(publicCases.createdAt))
      .limit(limit);
  },

  async byTier(db: Database, tier: string, limit = 50): Promise<PublicCase[]> {
    return db
      .select()
      .from(publicCases)
      .where(eq(publicCases.tier, tier))
      .orderBy(desc(publicCases.createdAt))
      .limit(limit);
  },

  async byCountry(db: Database, country: string, limit = 50): Promise<PublicCase[]> {
    return db
      .select()
      .from(publicCases)
      .where(eq(publicCases.country, country))
      .orderBy(desc(publicCases.createdAt))
      .limit(limit);
  },

  async byKeyword(db: Database, keyword: string, limit = 50): Promise<PublicCase[]> {
    return db
      .select()
      .from(publicCases)
      .where(sql`${keyword} = ANY(${publicCases.keywords})`)
      .orderBy(desc(publicCases.createdAt))
      .limit(limit);
  },

  async countByTier(db: Database): Promise<{ tier: string; count: number }[]> {
    return db
      .select({
        tier: publicCases.tier,
        count: sql<number>`count(*)::int`,
      })
      .from(publicCases)
      .groupBy(publicCases.tier);
  },

  async countByCountry(db: Database, limit = 20): Promise<{ country: string; count: number }[]> {
    const rows = await db
      .select({
        country: publicCases.country,
        count: sql<number>`count(*)::int`,
      })
      .from(publicCases)
      .where(sql`${publicCases.country} IS NOT NULL`)
      .groupBy(publicCases.country)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows as { country: string; count: number }[];
  },

  async topKeywords(db: Database, limit = 20): Promise<{ keyword: string; count: number }[]> {
    const rows = await db
      .select({
        keyword: sql<string>`unnest(${publicCases.keywords})`,
        count: sql<number>`count(*)::int`,
      })
      .from(publicCases)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows;
  },

  async statsSince(db: Database, sinceIsoUtc: string | null): Promise<{
    total: number;
    byTier: { tier: string; count: number }[];
    byCountry: { country: string; count: number }[];
  }> {
    const base = sinceIsoUtc
      ? db.select().from(publicCases).where(gte(publicCases.createdAt, new Date(sinceIsoUtc)))
      : db.select().from(publicCases);

    const rows = await (sinceIsoUtc
      ? db
          .select({
            tier: publicCases.tier,
            count: sql<number>`count(*)::int`,
          })
          .from(publicCases)
          .where(gte(publicCases.createdAt, new Date(sinceIsoUtc)))
          .groupBy(publicCases.tier)
      : db
          .select({
            tier: publicCases.tier,
            count: sql<number>`count(*)::int`,
          })
          .from(publicCases)
          .groupBy(publicCases.tier));

    const totalRows = await (sinceIsoUtc
      ? db.select({ n: sql<number>`count(*)::int` }).from(publicCases).where(gte(publicCases.createdAt, new Date(sinceIsoUtc)))
      : db.select({ n: sql<number>`count(*)::int` }).from(publicCases));

    return {
      total: totalRows[0]?.n ?? 0,
      byTier: rows,
      byCountry: [],
    };
  },

  async withSources(db: Database, limit = 50): Promise<(PublicCase & { sources: typeof sourceTraces.$inferSelect[] })[]> {
    const cases = await db
      .select()
      .from(publicCases)
      .orderBy(desc(publicCases.createdAt))
      .limit(limit);

    const casesWithSources = await Promise.all(
      cases.map(async (c) => {
        const sources = await db
          .select()
          .from(sourceTraces)
          .where(eq(sourceTraces.caseId, c.id));
        return { ...c, sources };
      })
    );

    return casesWithSources;
  },
};