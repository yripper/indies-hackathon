// Per-conversation pending-audio cache. When an audio arrives, we stash the
// decoded bytes here keyed by conversation id; the agent's analyze tool reads
// from here on user confirmation. Entries expire after 10 min so memory stays
// bounded and stale audios don't get analyzed if the user replies hours later.

const TTL_MS = 10 * 60 * 1000;

export type PendingAudio = {
  buffer: Buffer;
  mimetype: string;
  durationSec: number;
  fromName: string;
  source: 'direct' | 'quoted';
  createdAt: number;
};

const cache = new Map<string, PendingAudio>();

export function putPendingAudio(
  conversationId: string,
  audio: Omit<PendingAudio, 'createdAt'>,
): void {
  cache.set(conversationId, { ...audio, createdAt: Date.now() });
}

export function takePendingAudio(conversationId: string): PendingAudio | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  // Consume on read — analysis is one-shot per audio. Re-asking requires
  // a fresh audio forward, which prevents accidental re-analysis on chat noise.
  cache.delete(conversationId);
  return entry;
}

export function peekPendingAudio(conversationId: string): PendingAudio | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  return entry;
}

export function clearAudioCacheForTests(): void {
  cache.clear();
}
