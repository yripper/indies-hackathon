import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/config/logger', () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { checkRateLimit, recordAnalysis, _internals } from '../../src/rate-limit/analysis-limiter';

describe('analysis-limiter', () => {
  beforeEach(() => {
    // Clear all stored timestamps between tests
    _internals.store.clear();
  });

  describe('checkRateLimit', () => {
    it('allows a JID with no prior analyses', () => {
      const result = checkRateLimit('5491100001111@s.whatsapp.net');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(_internals.HOURLY_LIMIT);
    });

    it('decreases remaining count as analyses are recorded', () => {
      const jid = '5491100002222@s.whatsapp.net';
      recordAnalysis(jid);
      recordAnalysis(jid);

      const result = checkRateLimit(jid);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(_internals.HOURLY_LIMIT - 2);
    });

    it('denies when hourly limit is exhausted', () => {
      const jid = '5491100003333@s.whatsapp.net';
      for (let i = 0; i < _internals.HOURLY_LIMIT; i++) {
        recordAnalysis(jid);
      }

      const result = checkRateLimit(jid);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSec).toBeGreaterThan(0);
      expect(result.retryAfterSec).toBeLessThanOrEqual(3600);
      expect(result.remaining).toBe(0);
    });

    it('denies when daily limit is exhausted even if hourly slots are free', () => {
      const jid = '5491100004444@s.whatsapp.net';

      // Simulate analyses spread across different hours but within the same day.
      // Place DAILY_LIMIT entries across the last 24h, but space them so only
      // some fall within the last hour.
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;
      const timestamps: number[] = [];

      // Place entries 2 hours apart (so none more than HOURLY_LIMIT in one hour)
      for (let i = 0; i < _internals.DAILY_LIMIT; i++) {
        timestamps.push(now - (i * 2 * hourMs) - 1000); // spread across 30h, but only 12 within 24h
      }

      // Only keep those within 24h
      const dayMs = 24 * 60 * 60 * 1000;
      const withinDay = timestamps.filter((t) => t > now - dayMs);

      // We need exactly DAILY_LIMIT entries within 24h. Let's place them 90 min apart.
      _internals.store.clear();
      const controlled: number[] = [];
      for (let i = 0; i < _internals.DAILY_LIMIT; i++) {
        controlled.push(now - i * 90 * 60 * 1000); // 90 min apart
      }
      _internals.store.set(jid, controlled);

      const result = checkRateLimit(jid);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSec).toBeGreaterThan(0);
      expect(result.remaining).toBe(0);
    });

    it('allows again after the sliding window moves past old entries (hourly)', () => {
      const jid = '5491100005555@s.whatsapp.net';
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;

      // Place HOURLY_LIMIT entries just over 1 hour ago (expired from hourly window)
      const oldTimestamps = Array.from(
        { length: _internals.HOURLY_LIMIT },
        (_, i) => now - hourMs - 1000 - i * 100, // all slightly more than 1h ago
      );
      _internals.store.set(jid, oldTimestamps);

      const result = checkRateLimit(jid);
      expect(result.allowed).toBe(true);
      // Hourly remaining is full; daily remaining is limited
      expect(result.remaining).toBe(Math.min(_internals.HOURLY_LIMIT, _internals.DAILY_LIMIT - _internals.HOURLY_LIMIT));
    });
  });

  describe('recordAnalysis', () => {
    it('adds a timestamp for the JID', () => {
      const jid = '5491100006666@s.whatsapp.net';
      expect(_internals.store.has(jid)).toBe(false);

      recordAnalysis(jid);

      expect(_internals.store.has(jid)).toBe(true);
      expect(_internals.store.get(jid)!.length).toBe(1);
    });

    it('appends multiple timestamps for repeated calls', () => {
      const jid = '5491100007777@s.whatsapp.net';
      recordAnalysis(jid);
      recordAnalysis(jid);
      recordAnalysis(jid);

      expect(_internals.store.get(jid)!.length).toBe(3);
    });
  });

  describe('cleanup', () => {
    it('removes JIDs with only expired entries', () => {
      const jid = '5491100008888@s.whatsapp.net';
      const dayMs = 24 * 60 * 60 * 1000;
      // All entries older than 24h
      _internals.store.set(jid, [Date.now() - dayMs - 10000, Date.now() - dayMs - 20000]);

      _internals.cleanup();

      expect(_internals.store.has(jid)).toBe(false);
    });

    it('prunes expired entries but keeps active ones', () => {
      const jid = '5491100009999@s.whatsapp.net';
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      // Mix of expired and active
      _internals.store.set(jid, [
        now - dayMs - 5000, // expired
        now - dayMs - 3000, // expired
        now - 1000,         // active
        now - 500,          // active
      ]);

      _internals.cleanup();

      expect(_internals.store.has(jid)).toBe(true);
      expect(_internals.store.get(jid)!.length).toBe(2);
      // The remaining entries should be the recent ones
      expect(_internals.store.get(jid)![0]).toBe(now - 1000);
      expect(_internals.store.get(jid)![1]).toBe(now - 500);
    });

    it('does not affect JIDs with all-active entries', () => {
      const jid = '5491100001010@s.whatsapp.net';
      const now = Date.now();
      _internals.store.set(jid, [now - 1000, now - 500, now - 100]);

      _internals.cleanup();

      expect(_internals.store.has(jid)).toBe(true);
      expect(_internals.store.get(jid)!.length).toBe(3);
    });
  });
});
