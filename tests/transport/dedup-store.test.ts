import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the logger before importing the module
vi.mock('../../src/config/logger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock the DB schema to avoid importing Drizzle internals
vi.mock('../../src/db/schema', () => ({
  seenMessageIds: {
    waMessageId: 'wa_message_id',
    jid: 'jid',
    seenAt: 'seen_at',
  },
}));

import { alreadySeen, _clearForTests } from '../../src/transport/dedup-store';

describe('dedup-store', () => {
  beforeEach(() => {
    _clearForTests();
  });

  it('returns false for a new message ID', () => {
    const result = alreadySeen('msg-001', '5491100001111@s.whatsapp.net');
    expect(result).toBe(false);
  });

  it('returns true for a repeated message ID (hot cache hit)', () => {
    alreadySeen('msg-002', '5491100001111@s.whatsapp.net');
    const result = alreadySeen('msg-002', '5491100001111@s.whatsapp.net');
    expect(result).toBe(true);
  });

  it('returns false for null/undefined IDs', () => {
    expect(alreadySeen(null, '5491100001111@s.whatsapp.net')).toBe(false);
    expect(alreadySeen(undefined, '5491100001111@s.whatsapp.net')).toBe(false);
  });

  it('evicts oldest entry when hot cache exceeds max size', () => {
    // Fill the cache to the max (1000 entries)
    for (let i = 0; i < 1000; i++) {
      alreadySeen(`msg-fill-${i}`, 'jid@s.whatsapp.net');
    }

    // Adding one more should evict the oldest (msg-fill-0)
    alreadySeen('msg-overflow', 'jid@s.whatsapp.net');

    // The first entry should have been evicted, so it's "new" again
    const result = alreadySeen('msg-fill-0', 'jid@s.whatsapp.net');
    expect(result).toBe(false);

    // A recent entry should still be in the cache
    const recent = alreadySeen('msg-fill-999', 'jid@s.whatsapp.net');
    expect(recent).toBe(true);
  });

  it('_clearForTests resets the hot cache', () => {
    alreadySeen('msg-003', '5491100001111@s.whatsapp.net');
    expect(alreadySeen('msg-003', '5491100001111@s.whatsapp.net')).toBe(true);

    _clearForTests();

    // After clearing, the same ID should be "new" again
    expect(alreadySeen('msg-003', '5491100001111@s.whatsapp.net')).toBe(false);
  });

  it('different JIDs with same message ID still dedup (keyed by ID only)', () => {
    alreadySeen('msg-004', 'jid-a@s.whatsapp.net');
    // Same message ID from different JID — still a duplicate in the cache
    const result = alreadySeen('msg-004', 'jid-b@s.whatsapp.net');
    expect(result).toBe(true);
  });
});
