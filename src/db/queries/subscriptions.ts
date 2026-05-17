import { desc, eq, and, isNull } from 'drizzle-orm';
import type { Database } from '../connection';
import { subscriptions } from '../schema';
import { sql } from 'drizzle-orm';

export type Subscription = typeof subscriptions.$inferSelect;

export const subscriptionsRepo = {
  async insert(db: Database, input: {
    email: string;
    topics?: string[];
    frequency?: string;
    confirmed?: boolean;
    confirmationToken?: string | null;
  }): Promise<Subscription> {
    const [row] = await db
      .insert(subscriptions)
      .values({
        email: input.email,
        topics: input.topics ?? [],
        frequency: input.frequency ?? 'daily',
        confirmed: input.confirmed ?? false,
        confirmationToken: input.confirmationToken,
      })
      .returning();
    return row;
  },

  async findByEmail(db: Database, email: string): Promise<Subscription | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.email, email))
      .limit(1);
    return rows[0] ?? null;
  },

  async findByToken(db: Database, token: string): Promise<Subscription | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.confirmationToken, token))
      .limit(1);
    return rows[0] ?? null;
  },

  async confirm(db: Database, token: string): Promise<Subscription | null> {
    const [row] = await db
      .update(subscriptions)
      .set({ confirmed: true, confirmationToken: null })
      .where(eq(subscriptions.confirmationToken, token))
      .returning();
    return row ?? null;
  },

  async unsubscribe(db: Database, email: string): Promise<Subscription | null> {
    const [row] = await db
      .update(subscriptions)
      .set({ unsubscribedAt: new Date() })
      .where(eq(subscriptions.email, email))
      .returning();
    return row ?? null;
  },

  async updateTopics(db: Database, email: string, topics: string[]): Promise<Subscription | null> {
    const [row] = await db
      .update(subscriptions)
      .set({ topics })
      .where(eq(subscriptions.email, email))
      .returning();
    return row ?? null;
  },

  async confirmedSubscribers(db: Database): Promise<Subscription[]> {
    return db
      .select()
      .from(subscriptions)
      .where(and(
        eq(subscriptions.confirmed, true),
        eq(subscriptions.unsubscribedAt, sql`NULL`)
      ));
  },

  async byTopic(db: Database, topic: string): Promise<Subscription[]> {
    return db
      .select()
      .from(subscriptions)
      .where(and(
        eq(subscriptions.confirmed, true),
        sql`${topic} = ANY(${subscriptions.topics})`,
        eq(subscriptions.unsubscribedAt, sql`NULL`)
      ));
  },
};