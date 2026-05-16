import { describe, it, expect, vi } from 'vitest';
import { MediaStore } from '../../src/transport/media-store';

describe('MediaStore', () => {
  it('round-trips a buffer with mime type', () => {
    const store = new MediaStore();
    const buf = Buffer.from('hello');
    const entry = store.put(buf, 'image/jpeg');
    expect(entry.id).toMatch(/^med_[0-9a-f]{16}$/);
    expect(entry.mimeType).toBe('image/jpeg');

    const fetched = store.get(entry.id);
    expect(fetched?.buffer).toBe(buf);
    expect(fetched?.mimeType).toBe('image/jpeg');
  });

  it('returns null for unknown id', () => {
    const store = new MediaStore();
    expect(store.get('med_nope')).toBeNull();
  });

  it('expires entries past the TTL', () => {
    vi.useFakeTimers();
    try {
      const store = new MediaStore({ ttlMs: 1000 });
      const entry = store.put(Buffer.from('x'), 'image/png');
      expect(store.get(entry.id)).not.toBeNull();
      vi.advanceTimersByTime(1500);
      expect(store.get(entry.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts oldest entries when the cap is exceeded', () => {
    const store = new MediaStore({ maxEntries: 3 });
    const ids = [
      store.put(Buffer.from('a'), 'image/jpeg').id,
      store.put(Buffer.from('b'), 'image/jpeg').id,
      store.put(Buffer.from('c'), 'image/jpeg').id,
    ];
    expect(store.size()).toBe(3);

    store.put(Buffer.from('d'), 'image/jpeg');
    expect(store.size()).toBe(3);
    expect(store.get(ids[0])).toBeNull();
    expect(store.get(ids[1])).not.toBeNull();
  });
});
