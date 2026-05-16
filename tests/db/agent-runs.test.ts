import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { conversationsRepo } from '../../src/db/queries/conversations';
import { agentRunsRepo } from '../../src/db/queries/agent-runs';
import { makeTestDb, cleanDb } from './helpers';

const { db, client } = makeTestDb();

beforeEach(async () => {
  await cleanDb(db);
});

afterAll(async () => {
  await client.end();
});

async function seedConv() {
  return conversationsRepo.findOrCreate(db, { customerPhone: '+56900000000' });
}

describe('agentRunsRepo', () => {
  it('start creates a row with status=running and returns it', async () => {
    const conv = await seedConv();
    const run = await agentRunsRepo.start(db, {
      conversationId: conv.id,
      triggerMessageId: null,
      agentName: 'test-agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    expect(run.status).toBe('running');
    expect(run.agentName).toBe('test-agent');
    expect(run.iterations).toBe(0);
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeNull();
  });

  it('finish updates status, iterations, tokens, latency, finishedAt', async () => {
    const conv = await seedConv();
    const run = await agentRunsRepo.start(db, {
      conversationId: conv.id,
      triggerMessageId: null,
      agentName: 'test-agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    const finished = await agentRunsRepo.finish(db, run.id, {
      status: 'completed',
      iterations: 2,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1234,
    });
    expect(finished.status).toBe('completed');
    expect(finished.iterations).toBe(2);
    expect(finished.inputTokens).toBe(100);
    expect(finished.outputTokens).toBe(50);
    expect(finished.latencyMs).toBe(1234);
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });

  it('fail records errorMessage and sets status=failed', async () => {
    const conv = await seedConv();
    const run = await agentRunsRepo.start(db, {
      conversationId: conv.id,
      triggerMessageId: null,
      agentName: 'test-agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    const failed = await agentRunsRepo.fail(db, run.id, 'rate limit');
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBe('rate limit');
    expect(failed.finishedAt).toBeInstanceOf(Date);
  });
});
