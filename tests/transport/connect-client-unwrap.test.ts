import { describe, it, expect } from 'vitest';
import { unwrapMessage } from '../../src/transport/baileys/unwrap-message';

describe('unwrapMessage', () => {
  it('returns null/undefined as-is', () => {
    expect(unwrapMessage(null)).toBeNull();
    expect(unwrapMessage(undefined)).toBeUndefined();
  });

  it('passes through a plain imageMessage without modification', () => {
    const msg = { imageMessage: { mimetype: 'image/jpeg' } } as unknown;
    expect(unwrapMessage(msg as any)).toBe(msg);
  });

  it('passes through a plain audioMessage without modification', () => {
    const msg = { audioMessage: { mimetype: 'audio/ogg', seconds: 5 } } as unknown;
    expect(unwrapMessage(msg as any)).toBe(msg);
  });

  it('unwraps viewOnceMessage', () => {
    const inner = { imageMessage: { mimetype: 'image/jpeg' } };
    const wrapped = { viewOnceMessage: { message: inner } } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(inner);
  });

  it('unwraps viewOnceMessageV2', () => {
    const inner = { imageMessage: { mimetype: 'image/png' } };
    const wrapped = { viewOnceMessageV2: { message: inner } } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(inner);
  });

  it('unwraps viewOnceMessageV2Extension', () => {
    const inner = { videoMessage: { mimetype: 'video/mp4' } };
    const wrapped = { viewOnceMessageV2Extension: { message: inner } } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(inner);
  });

  it('unwraps ephemeralMessage', () => {
    const inner = { audioMessage: { mimetype: 'audio/ogg', seconds: 12 } };
    const wrapped = { ephemeralMessage: { message: inner } } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(inner);
  });

  it('unwraps documentWithCaptionMessage', () => {
    const inner = { imageMessage: { mimetype: 'image/jpeg' } };
    const wrapped = { documentWithCaptionMessage: { message: inner } } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(inner);
  });

  it('prefers viewOnce over ephemeral when both present (edge case)', () => {
    const viewOnceInner = { imageMessage: { mimetype: 'image/jpeg' } };
    const ephemeralInner = { audioMessage: { mimetype: 'audio/ogg' } };
    const wrapped = {
      viewOnceMessage: { message: viewOnceInner },
      ephemeralMessage: { message: ephemeralInner },
    } as unknown;
    // viewOnce is checked first
    expect(unwrapMessage(wrapped as any)).toBe(viewOnceInner);
  });

  it('does not unwrap if wrapper has no inner message', () => {
    const wrapped = { viewOnceMessage: {} } as unknown;
    expect(unwrapMessage(wrapped as any)).toBe(wrapped);
  });

  it('handles deeply nested ephemeral with imageMessage', () => {
    const inner = { imageMessage: { mimetype: 'image/webp', caption: 'hello' } };
    const wrapped = { ephemeralMessage: { message: inner } } as unknown;
    const result = unwrapMessage(wrapped as any);
    expect(result).toBe(inner);
    expect((result as any).imageMessage.caption).toBe('hello');
  });
});
