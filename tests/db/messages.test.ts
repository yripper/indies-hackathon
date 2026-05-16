import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { conversationsRepo } from '../../src/db/queries/conversations';
import { messagesRepo } from '../../src/db/queries/messages';
import { makeTestDb, cleanDb } from './helpers';

const { db, client } = makeTestDb();

beforeEach(async () => {
  await cleanDb(db);
});

afterAll(async () => {
  await client.end();
});

async function seedConversation() {
  return conversationsRepo.findOrCreate(db, { customerPhone: '+56900000000' });
}

describe('messagesRepo', () => {
  it('create stores a message and returns it', async () => {
    const conv = await seedConversation();
    const m = await messagesRepo.create(db, {
      conversationId: conv.id,
      role: 'user',
      content: 'hello',
    });
    expect(m.id).toBeTypeOf('string');
    expect(m.role).toBe('user');
    expect(m.content).toBe('hello');
  });

  it('listRecent returns the last N messages ordered chronologically', async () => {
    const conv = await seedConversation();
    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      await messagesRepo.create(db, { conversationId: conv.id, role: 'user', content: text });
    }
    const recent = await messagesRepo.listRecent(db, conv.id, 3);
    expect(recent.map((m) => m.content)).toEqual(['c', 'd', 'e']);
  });

  it('listRecent returns [] for an unknown conversation', async () => {
    const recent = await messagesRepo.listRecent(db, '00000000-0000-0000-0000-000000000000', 10);
    expect(recent).toEqual([]);
  });

  it('preserves toolName + toolCallId for tool messages', async () => {
    const conv = await seedConversation();
    const m = await messagesRepo.create(db, {
      conversationId: conv.id,
      role: 'tool',
      content: '42',
      toolName: 'calculator',
      toolCallId: 'call_abc',
    });
    expect(m.toolName).toBe('calculator');
    expect(m.toolCallId).toBe('call_abc');
  });
});
