import { asc, eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { toolCalls } from '../schema';

export type ToolCall = typeof toolCalls.$inferSelect;

export type CreateToolCallInput = {
  agentRunId: string;
  toolName: string;
  toolCallId: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  latencyMs?: number;
  succeeded: boolean;
};

export const toolCallsRepo = {
  async createMany(db: Database, inputs: CreateToolCallInput[]): Promise<ToolCall[]> {
    if (inputs.length === 0) return [];
    const rows = await db
      .insert(toolCalls)
      .values(
        inputs.map((i) => ({
          agentRunId: i.agentRunId,
          toolName: i.toolName,
          toolCallId: i.toolCallId,
          arguments: i.arguments,
          result: i.result ?? null,
          error: i.error ?? null,
          latencyMs: i.latencyMs ?? null,
          succeeded: i.succeeded,
        })),
      )
      .returning();
    return rows;
  },

  async listByRun(db: Database, agentRunId: string): Promise<ToolCall[]> {
    return db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.agentRunId, agentRunId))
      .orderBy(asc(toolCalls.invokedAt));
  },
};
