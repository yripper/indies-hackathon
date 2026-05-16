import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/connection';
import { conversations, messages, agentRuns, toolCalls } from '../db/schema';

export type DebugRoutesOptions = {
  db: Database;
};

export async function debugRoutes(app: FastifyInstance, opts: DebugRoutesOptions): Promise<void> {
  app.get('/v1/conversations', async () => {
    return opts.db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(100);
  });

  app.get<{ Params: { id: string } }>('/v1/conversations/:id/messages', async (req) => {
    const rows = await opts.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(messages.createdAt);
    return rows;
  });

  app.get<{ Params: { id: string } }>('/v1/runs/:id', async (req, reply) => {
    const runRows = await opts.db.select().from(agentRuns).where(eq(agentRuns.id, req.params.id)).limit(1);
    if (!runRows[0]) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const tcRows = await opts.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.agentRunId, req.params.id))
      .orderBy(toolCalls.invokedAt);
    return { run: runRows[0], toolCalls: tcRows };
  });
}
