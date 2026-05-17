import { describe, it, expect } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import { detectForwarding } from '../../src/transport/forward-detector';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal WAMessage with contextInfo on the given message type.
 */
function makeMsg(
  messageType: string,
  contextInfo: { isForwarded?: boolean; forwardingScore?: number } | null,
): WAMessage {
  const inner = contextInfo !== null ? { contextInfo } : {};
  return {
    key: { remoteJid: '+56911111111', fromMe: false, id: 'test-id' },
    message: { [messageType]: inner },
  } as unknown as WAMessage;
}

function makeConversationMsg(
  contextInfo: { isForwarded?: boolean; forwardingScore?: number } | null,
): WAMessage {
  // `conversation` messages don't carry contextInfo — use extendedTextMessage instead
  // for forwarded plain text.
  if (contextInfo === null) {
    return {
      key: { remoteJid: '+56911111111', fromMe: false, id: 'test-id' },
      message: { conversation: 'hello' },
    } as unknown as WAMessage;
  }
  return makeMsg('extendedTextMessage', contextInfo);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectForwarding', () => {
  describe('non-forwarded messages', () => {
    it('returns viralLevel=none for a plain conversation message', () => {
      const msg = makeConversationMsg(null);
      const result = detectForwarding(msg);
      expect(result).toEqual({ isForwarded: false, forwardingScore: 0, viralLevel: 'none' });
    });

    it('returns viralLevel=none when message has no message payload', () => {
      const msg = { key: { remoteJid: '+1', fromMe: false, id: 'x' }, message: null } as unknown as WAMessage;
      const result = detectForwarding(msg);
      expect(result).toEqual({ isForwarded: false, forwardingScore: 0, viralLevel: 'none' });
    });

    it('returns viralLevel=none when contextInfo has isForwarded=false', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: false, forwardingScore: 0 });
      const result = detectForwarding(msg);
      expect(result).toEqual({ isForwarded: false, forwardingScore: 0, viralLevel: 'none' });
    });
  });

  describe('forwarded once (score=1)', () => {
    it('returns viralLevel=low for extendedTextMessage with forwardingScore=1', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: true, forwardingScore: 1 });
      const result = detectForwarding(msg);
      expect(result.isForwarded).toBe(true);
      expect(result.forwardingScore).toBe(1);
      expect(result.viralLevel).toBe('low');
    });
  });

  describe('forwarded multiple times (score=2–4)', () => {
    it('returns viralLevel=low for forwardingScore=2', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: true, forwardingScore: 2 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('low');
      expect(result.forwardingScore).toBe(2);
    });

    it('returns viralLevel=low for forwardingScore=4', () => {
      const msg = makeMsg('imageMessage', { isForwarded: true, forwardingScore: 4 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('low');
    });
  });

  describe('highly forwarded / viral (score >= 5 or no score)', () => {
    it('returns viralLevel=high for forwardingScore=5', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: true, forwardingScore: 5 });
      const result = detectForwarding(msg);
      expect(result.isForwarded).toBe(true);
      expect(result.forwardingScore).toBe(5);
      expect(result.viralLevel).toBe('high');
    });

    it('returns viralLevel=high for forwardingScore=100', () => {
      const msg = makeMsg('videoMessage', { isForwarded: true, forwardingScore: 100 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('high');
    });

    it('returns viralLevel=high when isForwarded=true with no score (score defaults to 0)', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: true });
      const result = detectForwarding(msg);
      expect(result.isForwarded).toBe(true);
      expect(result.forwardingScore).toBe(0);
      expect(result.viralLevel).toBe('high');
    });
  });

  describe('extraction from different message types', () => {
    it('extracts from imageMessage', () => {
      const msg = makeMsg('imageMessage', { isForwarded: true, forwardingScore: 7 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('high');
      expect(result.forwardingScore).toBe(7);
    });

    it('extracts from videoMessage', () => {
      const msg = makeMsg('videoMessage', { isForwarded: true, forwardingScore: 3 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('low');
      expect(result.forwardingScore).toBe(3);
    });

    it('extracts from audioMessage', () => {
      const msg = makeMsg('audioMessage', { isForwarded: true, forwardingScore: 6 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('high');
    });

    it('extracts from extendedTextMessage', () => {
      const msg = makeMsg('extendedTextMessage', { isForwarded: true, forwardingScore: 1 });
      const result = detectForwarding(msg);
      expect(result.isForwarded).toBe(true);
    });

    it('extracts from documentMessage', () => {
      const msg = makeMsg('documentMessage', { isForwarded: true, forwardingScore: 5 });
      const result = detectForwarding(msg);
      expect(result.viralLevel).toBe('high');
    });
  });

  describe('infers isForwarded from score alone', () => {
    it('treats forwardingScore > 0 without explicit isForwarded as forwarded', () => {
      // Some WA clients omit isForwarded but include forwardingScore
      const msg = makeMsg('extendedTextMessage', { forwardingScore: 3 });
      const result = detectForwarding(msg);
      expect(result.isForwarded).toBe(true);
      expect(result.viralLevel).toBe('low');
    });
  });
});
