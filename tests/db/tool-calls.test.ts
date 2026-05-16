import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { conversationsRepo } from '../../src/db/queries/conversations';
import { agentRunsRepo } from '../../src/db/queries/agent-runs';
import { toolCallsRepo } from '../../src/db/queries/tool-calls';
import { makeTestDb, cleanDb } from './helpers';

const { db, client } = makeTestDb();

beforeEach(async () => {
  await cleanDb(db);
});

afterAll(async () => {
  await client.end();
});

async function seedRun() {
  const conv = await conversationsRepo.findOrCreate(db, { customerPhone: '+56900000000' });
  return agentRunsRepo.start(db, {
    conversationId: conv.id,
    triggerMessageId: null,
    agentName: 'test-agent',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  });
}

describe('toolCallsRepo', () => {
  it('createMany inserts all entries and returns them', async () => {
    const run = await seedRun();
    const rows = await toolCallsRepo.createMany(db, [
      {
        agentRunId: run.id,
        toolName: 'echo',
        toolCallId: 'call_1',
        arguments: { text: 'hi' },
        result: 'hi',
        latencyMs: 12,
        succeeded: true,
      },
      {
        agentRunId: run.id,
        toolName: 'calculator',
        toolCallId: 'call_2',
        arguments: { expression: '2+2' },
        error: 'boom',
        latencyMs: 5,
        succeeded: false,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].toolName).toBe('echo');
    expect(rows[1].succeeded).toBe(false);
  });

  it('createMany on empty array returns empty array without inserting', async () => {
    const rows = await toolCallsRepo.createMany(db, []);
    expect(rows).toEqual([]);
  });

  it('listByRun returns tool calls in chronological order', async () => {
    const run = await seedRun();
    await toolCallsRepo.createMany(db, [
      { agentRunId: run.id, toolName: 'a', toolCallId: 'c1', arguments: {}, succeeded: true },
      { agentRunId: run.id, toolName: 'b', toolCallId: 'c2', arguments: {}, succeeded: true },
    ]);
    const rows = await toolCallsRepo.listByRun(db, run.id);
    expect(rows.map((r) => r.toolName)).toEqual(['a', 'b']);
  });
});
