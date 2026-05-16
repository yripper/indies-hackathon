import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { messages } from '../schema';

export type Message = typeof messages.$inferSelect;

export type CreateMessageInput = {
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
};

export const messagesRepo = {
  async create(db: Database, input: CreateMessageInput): Promise<Message> {
    const [row] = await db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        toolCallId: input.toolCallId ?? null,
      })
      .returning();
    return row;
  },

  async listRecent(db: Database, conversationId: string, limit: number): Promise<Message[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    // Return chronological (oldest first) for LLM history
    return rows.reverse();
  },

  async listByConversation(db: Database, conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  },
};
