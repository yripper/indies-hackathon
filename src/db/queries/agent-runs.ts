import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { agentRuns } from '../schema';

export type AgentRun = typeof agentRuns.$inferSelect;

export type StartRunInput = {
  conversationId: string;
  triggerMessageId: string | null;
  agentName: string;
  provider: string;
  model: string;
};

export type FinishRunInput = {
  status: 'completed' | 'capped';
  iterations: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export const agentRunsRepo = {
  async start(db: Database, input: StartRunInput): Promise<AgentRun> {
    const [row] = await db
      .insert(agentRuns)
      .values({
        conversationId: input.conversationId,
        triggerMessageId: input.triggerMessageId,
        agentName: input.agentName,
        provider: input.provider,
        model: input.model,
        status: 'running',
      })
      .returning();
    return row;
  },

  async finish(db: Database, id: string, input: FinishRunInput): Promise<AgentRun> {
    const [row] = await db
      .update(agentRuns)
      .set({
        status: input.status,
        iterations: input.iterations,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, id))
      .returning();
    return row;
  },

  async fail(db: Database, id: string, errorMessage: string): Promise<AgentRun> {
    const [row] = await db
      .update(agentRuns)
      .set({ status: 'failed', errorMessage, finishedAt: new Date() })
      .where(eq(agentRuns.id, id))
      .returning();
    return row;
  },

  async findById(db: Database, id: string): Promise<AgentRun | null> {
    const rows = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return rows[0] ?? null;
  },
};
