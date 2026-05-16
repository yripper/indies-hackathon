// Per-conversation pending-image cache. When an image arrives, we stash the
// decoded bytes here keyed by conversation id; the agent's analyze tool reads
// from here on user confirmation. Entries expire after 10 min so memory stays
// bounded and stale images don't get analyzed if the user replies hours later.

const TTL_MS = 10 * 60 * 1000;

export type PendingImage = {
  buffer: Buffer;
  mimetype: string;
  bytes: number;
  fromName: string;
  source: 'direct' | 'quoted';
  createdAt: number;
};

const cache = new Map<string, PendingImage>();

export function putPendingImage(
  conversationId: string,
  image: Omit<PendingImage, 'createdAt'>,
): void {
  cache.set(conversationId, { ...image, createdAt: Date.now() });
}

export function takePendingImage(conversationId: string): PendingImage | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  // Consume on read — analysis is one-shot per image. Re-asking requires
  // a fresh image forward, which prevents accidental re-analysis on chat noise.
  cache.delete(conversationId);
  return entry;
}

export function peekPendingImage(conversationId: string): PendingImage | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  return entry;
}

export function clearImageCacheForTests(): void {
  cache.clear();
}
