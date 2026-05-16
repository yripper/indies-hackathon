/**
 * In-memory store of inbound media (WhatsApp image/video/audio attachments)
 * keyed by a short token. Used to expose the binary through a local HTTP
 * route so the agent's image-detection tools — which all take an
 * `image_url` argument — can analyze attachments end-to-end without any
 * special media-handling code in the tools themselves.
 *
 * Eviction policy:
 *   - TTL per entry (default 1h)
 *   - Hard cap (default 200 entries) — when exceeded, the oldest entries
 *     are evicted first.
 *
 * Not persisted. A server restart drops all in-flight media; the user has
 * to re-share the attachment. That trade-off is acceptable for a hackathon-
 * grade single-tenant deployment.
 */

import { randomBytes } from 'node:crypto';

export interface MediaEntry {
  id: string;
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}

export interface MediaStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX = 200;

export class MediaStore {
  private readonly entries = new Map<string, MediaEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: MediaStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX;
  }

  put(buffer: Buffer, mimeType: string): MediaEntry {
    this.evictExpired();
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    const id = `med_${randomBytes(8).toString('hex')}`;
    const entry: MediaEntry = { id, buffer, mimeType, createdAt: Date.now() };
    this.entries.set(id, entry);
    return entry;
  }

  get(id: string): MediaEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  size(): number {
    return this.entries.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) this.entries.delete(id);
    }
  }
}
