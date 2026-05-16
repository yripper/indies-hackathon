import { logger } from '../config/logger';

const log = logger.child({ module: 'rate-limiter' });

// ---------------------------------------------------------------------------
// Configuration — override via env vars or keep defaults
// ---------------------------------------------------------------------------

const HOURLY_LIMIT = parseInt(process.env.RATE_LIMIT_HOURLY ?? '5', 10);
const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_DAILY ?? '15', 10);
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory sliding window store
// ---------------------------------------------------------------------------

// Each entry is a timestamp (ms) when an analysis was recorded for a JID.
const store = new Map<string, number[]>();

/**
 * Returns rate-limit status for a given JID without recording a new event.
 */
export function checkRateLimit(jid: string): {
  allowed: boolean;
  retryAfterSec?: number;
  remaining: number;
} {
  const now = Date.now();
  const timestamps = store.get(jid) ?? [];

  // Count analyses within the last hour and last day
  const hourStart = now - HOUR_MS;
  const dayStart = now - DAY_MS;

  const inHour = timestamps.filter((t) => t > hourStart);
  const inDay = timestamps.filter((t) => t > dayStart);

  // Check hourly limit
  if (inHour.length >= HOURLY_LIMIT) {
    const oldestInWindow = inHour[0]!;
    const retryAfterMs = oldestInWindow + HOUR_MS - now;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    log.warn({ jid, inHour: inHour.length, limit: HOURLY_LIMIT }, 'hourly rate limit hit');
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  // Check daily limit
  if (inDay.length >= DAILY_LIMIT) {
    const oldestInWindow = inDay[0]!;
    const retryAfterMs = oldestInWindow + DAY_MS - now;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    log.warn({ jid, inDay: inDay.length, limit: DAILY_LIMIT }, 'daily rate limit hit');
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  // Remaining is the minimum of both windows
  const hourlyRemaining = HOURLY_LIMIT - inHour.length;
  const dailyRemaining = DAILY_LIMIT - inDay.length;
  const remaining = Math.min(hourlyRemaining, dailyRemaining);

  return { allowed: true, remaining };
}

/**
 * Records a successful analysis for a JID.
 * Call this AFTER the detection API call succeeds.
 */
export function recordAnalysis(jid: string): void {
  const now = Date.now();
  const timestamps = store.get(jid) ?? [];
  timestamps.push(now);
  store.set(jid, timestamps);
  log.info({ jid, total: timestamps.length }, 'analysis recorded');
}

// ---------------------------------------------------------------------------
// Periodic cleanup — prune entries older than 24h so memory stays bounded
// ---------------------------------------------------------------------------

function cleanup(): void {
  const cutoff = Date.now() - DAY_MS;
  let prunedJids = 0;
  let prunedEntries = 0;

  for (const [jid, timestamps] of store) {
    const active = timestamps.filter((t) => t > cutoff);
    if (active.length === 0) {
      store.delete(jid);
      prunedJids++;
      prunedEntries += timestamps.length;
    } else if (active.length < timestamps.length) {
      prunedEntries += timestamps.length - active.length;
      store.set(jid, active);
    }
  }

  if (prunedJids > 0 || prunedEntries > 0) {
    log.debug({ prunedJids, prunedEntries, remainingJids: store.size }, 'cleanup completed');
  }
}

const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
// Allow the process to exit without waiting for the interval
cleanupTimer.unref();

// ---------------------------------------------------------------------------
// Exports for testing — allows tests to manipulate internal state
// ---------------------------------------------------------------------------

/** @internal — exposed for tests only */
export const _internals = {
  store,
  cleanup,
  HOURLY_LIMIT,
  DAILY_LIMIT,
};
