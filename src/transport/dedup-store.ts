import { logger } from '../config/logger';
import { seenMessageIds } from '../db/schema';
import { gte, lt } from 'drizzle-orm';
import type { Database } from '../db/connection';

const log = logger.child({ module: 'dedup-store' });

// In-memory hot cache (fast path — avoids DB round-trip for recent messages)
const HOT_CACHE_MAX = 1000;
const hotCache = new Set<string>();

// How long to keep entries in DB (older ones get pruned)
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

let db: Database | null = null;

export function initDedupStore(database: Database): void {
  db = database;
  // Load recent IDs into hot cache on startup
  loadRecentIds().catch((err) => log.warn({ err }, 'failed to pre-load dedup IDs'));
  // Prune old entries every hour
  const interval = setInterval(() => pruneOld().catch(() => {}), 60 * 60 * 1000);
  interval.unref();
}

async function loadRecentIds(): Promise<void> {
  if (!db) return;
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const rows = await db
    .select({ id: seenMessageIds.waMessageId })
    .from(seenMessageIds)
    .where(gte(seenMessageIds.seenAt, cutoff))
    .limit(HOT_CACHE_MAX);
  for (const r of rows) hotCache.add(r.id);
  log.info({ loaded: rows.length }, 'pre-loaded dedup IDs from DB');
}

async function pruneOld(): Promise<void> {
  if (!db) return;
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const result = await db.delete(seenMessageIds).where(lt(seenMessageIds.seenAt, cutoff));
  log.debug({ pruned: (result as unknown as { rowCount?: number }).rowCount }, 'pruned old dedup entries');
}

/**
 * Returns true if the message ID has already been processed.
 * For new IDs, adds them to the hot cache and persists to DB asynchronously.
 */
export function alreadySeen(id: string | null | undefined, jid: string): boolean {
  if (!id) return false;
  if (hotCache.has(id)) return true;

  // Add to hot cache
  hotCache.add(id);
  if (hotCache.size > HOT_CACHE_MAX) {
    const oldest = hotCache.values().next().value;
    if (oldest) hotCache.delete(oldest);
  }

  // Persist async (fire-and-forget — don't block message processing)
  if (db) {
    db.insert(seenMessageIds)
      .values({ waMessageId: id, jid })
      .onConflictDoNothing()
      .catch((err) => log.warn({ err, id }, 'dedup insert failed'));
  }

  return false;
}

// For tests
export function _clearForTests(): void {
  hotCache.clear();
}
