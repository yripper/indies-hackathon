import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { handleIncomingMessage } from '../../src/transport/message-router';
import { conversationsRepo } from '../../src/db/queries/conversations';
import { messagesRepo } from '../../src/db/queries/messages';
import { toolCallsRepo } from '../../src/db/queries/tool-calls';
import { agentRuns } from '../../src/db/schema';
import { buildGraph } from '../../src/agent/graph';
import { echoTool } from '../../src/agent/tools/echo';
import { MockChatModel } from '../helpers/mock-llm';
import { makeTestDb, cleanDb } from '../db/helpers';

const { db, client } = makeTestDb();

beforeEach(async () => {
  await cleanDb(db);
});

afterAll(async () => {
  await client.end();
});

function makeDeps(opts: {
  graphScript: ConstructorParameters<typeof MockChatModel>[0];
  send: ReturnType<typeof vi.fn>;
}) {
  const llm = new MockChatModel(opts.graphScript);
  const graph = buildGraph({
    llm,
    tools: [echoTool],
    systemPrompt: 'You are X.',
    maxIterations: 5,
  });
  return {
    db,
    config: {
      agent: { name: 'test-agent', system_prompt: 'You are X.' },
      provider: { name: 'anthropic' as const, model: 'claude-sonnet-4-6', temperature: 0.3, max_tokens: 1024 },
      tools: { enabled: ['echo'], config: {} },
      limits: { max_tool_iterations: 5, history_window: 30, per_message_timeout_ms: 60_000 },
    },
    graph,
    // Cast the Vitest mock to the narrower send signature expected by MessageRouterDeps.
    send: opts.send as (to: string, text: string) => Promise<void>,
  };
}

async function runsForConversation(conversationId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.conversationId, conversationId));
}

describe('handleIncomingMessage', () => {
  it('happy path: stores user msg, invokes graph, stores assistant msg, sends reply', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      graphScript: [{ type: 'text', content: 'hi back' }],
      send,
    });

    await handleIncomingMessage(deps, {
      customerPhone: '+56911111111',
      customerName: 'Ada',
      text: 'hello',
    });

    const conv = await conversationsRepo.findByPhone(db, '+56911111111');
    expect(conv).not.toBeNull();
    const msgs = await messagesRepo.listByConversation(db, conv!.id);
    expect(msgs.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi back' },
    ]);
    expect(send).toHaveBeenCalledWith('+56911111111', 'hi back');
  });

  it('persists agent_runs row in status=completed with iterations and latency', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      graphScript: [{ type: 'text', content: 'ok' }],
      send,
    });

    await handleIncomingMessage(deps, {
      customerPhone: '+56922222222',
      customerName: 'Bob',
      text: 'hi',
    });

    const conv = await conversationsRepo.findByPhone(db, '+56922222222');
    const runs = await runsForConversation(conv!.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].iterations).toBeGreaterThan(0);
    expect(runs[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('persists tool_calls when graph invokes a tool', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      graphScript: [
        { type: 'tool_call', toolName: 'echo', args: { text: 'pong' }, toolCallId: 'c1' },
        { type: 'text', content: 'echoed pong' },
      ],
      send,
    });

    await handleIncomingMessage(deps, {
      customerPhone: '+56933333333',
      customerName: 'Carol',
      text: 'echo pong please',
    });

    const conv = await conversationsRepo.findByPhone(db, '+56933333333');
    const runs = await runsForConversation(conv!.id);
    expect(runs).toHaveLength(1);
    const calls = await toolCallsRepo.listByRun(db, runs[0].id);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('echo');
    expect(calls[0].succeeded).toBe(true);
    expect(send).toHaveBeenCalledWith('+56933333333', 'echoed pong');
  });

  it('on graph error: marks run failed, sends fallback message', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      graphScript: [],
      send,
    });

    await handleIncomingMessage(deps, {
      customerPhone: '+56944444444',
      customerName: 'Dora',
      text: 'oops',
    });

    expect(send).toHaveBeenCalledWith('+56944444444', expect.stringMatching(/error/i));
    const conv = await conversationsRepo.findByPhone(db, '+56944444444');
    const runs = await runsForConversation(conv!.id);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].errorMessage).toBeTruthy();
  });
});
