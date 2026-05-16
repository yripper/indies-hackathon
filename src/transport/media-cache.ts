// Per-conversation pending-media cache. When media (audio, image, video,
// document) arrives, we stash the decoded bytes here keyed by conversation
// id; the agent's analyze tool reads from here on user confirmation. Entries
// expire after 10 min so memory stays bounded and stale media doesn't get
// analyzed if the user replies hours later.

const TTL_MS = 10 * 60 * 1000;

export type MediaKind = 'audio' | 'image' | 'video' | 'document';

export type PendingMedia = {
  buffer: Buffer;
  mimetype: string;
  kind: MediaKind;
  // Present for audio/video; null/undefined for image/document.
  durationSec?: number;
  // Original WhatsApp filename, mainly for documentMessage (e.g. "boleta.pdf").
  fileName?: string;
  fromName: string;
  source: 'direct' | 'quoted';
  createdAt: number;
};

const cache = new Map<string, PendingMedia>();

export function putPendingMedia(
  conversationId: string,
  media: Omit<PendingMedia, 'createdAt'>,
): void {
  cache.set(conversationId, { ...media, createdAt: Date.now() });
}

export function takePendingMedia(conversationId: string): PendingMedia | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  // Consume on read — analysis is one-shot per media. Re-asking requires
  // a fresh forward, which prevents accidental re-analysis on chat noise.
  cache.delete(conversationId);
  return entry;
}

export function peekPendingMedia(conversationId: string): PendingMedia | null {
  const entry = cache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(conversationId);
    return null;
  }
  return entry;
}

export function clearMediaCacheForTests(): void {
  cache.clear();
}
