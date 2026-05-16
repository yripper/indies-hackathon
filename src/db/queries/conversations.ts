import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { conversations } from '../schema';

export type Conversation = typeof conversations.$inferSelect;

export type FindOrCreateInput = {
  customerPhone: string;
  customerName?: string;
};

export const conversationsRepo = {
  async findOrCreate(db: Database, input: FindOrCreateInput): Promise<Conversation> {
    const existing = await db
      .select()
      .from(conversations)
      .where(eq(conversations.customerPhone, input.customerPhone))
      .limit(1);

    if (existing[0]) {
      if (input.customerName && !existing[0].customerName) {
        const [updated] = await db
          .update(conversations)
          .set({ customerName: input.customerName, updatedAt: new Date() })
          .where(eq(conversations.id, existing[0].id))
          .returning();
        return updated;
      }
      return existing[0];
    }

    const [created] = await db
      .insert(conversations)
      .values({ customerPhone: input.customerPhone, customerName: input.customerName ?? null })
      .returning();
    return created;
  },

  async findByPhone(db: Database, phone: string): Promise<Conversation | null> {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.customerPhone, phone))
      .limit(1);
    return rows[0] ?? null;
  },
};
