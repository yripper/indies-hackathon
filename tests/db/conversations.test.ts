import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { conversationsRepo } from '../../src/db/queries/conversations';
import { makeTestDb, cleanDb } from './helpers';

const { db, client } = makeTestDb();

beforeEach(async () => {
  await cleanDb(db);
});

afterAll(async () => {
  await client.end();
});

describe('conversationsRepo', () => {
  it('findOrCreate creates a new conversation on first call', async () => {
    const conv = await conversationsRepo.findOrCreate(db, {
      customerPhone: '+56911111111',
      customerName: 'Ada',
    });
    expect(conv.customerPhone).toBe('+56911111111');
    expect(conv.customerName).toBe('Ada');
    expect(conv.status).toBe('active');
  });

  it('findOrCreate returns the existing conversation on subsequent calls', async () => {
    const a = await conversationsRepo.findOrCreate(db, { customerPhone: '+56922222222' });
    const b = await conversationsRepo.findOrCreate(db, { customerPhone: '+56922222222' });
    expect(a.id).toBe(b.id);
  });

  it('updates customerName if provided and previously null', async () => {
    const a = await conversationsRepo.findOrCreate(db, { customerPhone: '+56933333333' });
    expect(a.customerName).toBeNull();
    const b = await conversationsRepo.findOrCreate(db, {
      customerPhone: '+56933333333',
      customerName: 'Bob',
    });
    expect(b.customerName).toBe('Bob');
  });
});
