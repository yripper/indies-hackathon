// Per-conversation pending-video cache. When a video arrives, we stash the
// temp file path here keyed by conversation id; the agent's video tool reads
// from here. Entries expire after 10 min so stale videos don't accumulate.

const TTL_MS = 10 * 60 * 1000;

export type PendingVideo = {
  filePath: string;
  mimetype: string;
  bytes: number;
  fromName: string;
  source: 'direct' | 'quoted';
  createdAt: number;
};

const cache = new Map<string, PendingVideo>();

export function putPendingVideo(
  conversationId: string,
  video: Omit<PendingVideo, 'createdAt'>,
): void {
  cache.set(conversationId, { ...video, createdAt: Date.now() });
}

export function takePendingVideo(conversationId: string): PendingVideo | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  cache.delete(conversationId);
  return entry;
}

export function peekPendingVideo(conversationId: string): PendingVideo | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  return entry;
}

export function clearVideoCacheForTests(): void {
  cache.clear();
}
