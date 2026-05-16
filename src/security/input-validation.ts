/**
 * Centralized input validation and sanitization helpers for the WhatsApp
 * deepfake-detection pipeline. Defence-in-depth: even though WhatsApp imposes
 * its own limits (≈16 MB audio, ≈100 MB video), we enforce our own ceilings
 * to protect downstream APIs and memory usage.
 */

// ─── Media size limits ───────────────────────────────────────────────────────

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;  // 25 MB
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

export type MediaType = 'audio' | 'image' | 'video';

const MEDIA_LIMITS: Record<MediaType, number> = {
  audio: MAX_AUDIO_BYTES,
  image: MAX_IMAGE_BYTES,
  video: MAX_VIDEO_BYTES,
};

/**
 * Returns `true` if the buffer is within the allowed size for the given media
 * type. Returns `false` (reject) if it exceeds the limit.
 */
export function validateMediaSize(
  buffer: Buffer | Uint8Array,
  mediaType: MediaType,
): boolean {
  return buffer.length <= MEDIA_LIMITS[mediaType];
}

// ─── MIME-type allowlists ────────────────────────────────────────────────────

export const ALLOWED_AUDIO_MIMES = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/flac',
  'audio/aac',
  'audio/m4a',
  'audio/x-m4a',
];

export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
];

export const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
];

const MIME_ALLOWLISTS: Record<MediaType, string[]> = {
  audio: ALLOWED_AUDIO_MIMES,
  image: ALLOWED_IMAGE_MIMES,
  video: ALLOWED_VIDEO_MIMES,
};

/**
 * Validates a MIME type against the allowlist for the given media category.
 * Handles MIME types with parameters (e.g. "audio/ogg; codecs=opus") by
 * checking if the mimetype _starts with_ any allowed prefix.
 */
export function validateMimetype(
  mimetype: string,
  mediaType: MediaType,
): boolean {
  const allowed = MIME_ALLOWLISTS[mediaType];
  const normalized = mimetype.toLowerCase().trim();
  return allowed.some((prefix) => normalized.startsWith(prefix));
}

// ─── Push-name sanitization ──────────────────────────────────────────────────

const MAX_PUSH_NAME_LENGTH = 100;

/**
 * Sanitize a WhatsApp pushName (display name). Removes control characters and
 * truncates to a safe length. Returns empty string for null/undefined input.
 */
export function sanitizePushName(name: string | null | undefined): string {
  if (!name) return '';
  // Remove C0/C1 control characters and DEL
  return name
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim()
    .slice(0, MAX_PUSH_NAME_LENGTH);
}

// ─── SSRF protection ─────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS metadata endpoint
  '[::1]',
];

const BLOCKED_HOSTNAME_SUFFIXES = ['.internal', '.local', '.localhost'];

/**
 * Returns `true` if the URL points to a private/internal address and should
 * be blocked (SSRF protection).
 */
export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.includes(hostname)) return true;
    if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) return true;

    // Block private IPv4 ranges
    if (/^10\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;

    return false;
  } catch {
    // If URL is unparseable, treat as blocked (fail-closed)
    return true;
  }
}

// ─── Per-JID message rate limiting ───────────────────────────────────────────

const MESSAGE_RATE_LIMIT = 20; // max messages per JID per 60 seconds
const RATE_WINDOW_MS = 60_000;

const messageRateMap = new Map<string, number[]>();

/**
 * Returns `true` if the JID has exceeded the message rate limit (flooding).
 * If under the limit, the current timestamp is recorded and `false` returned.
 */
export function isMessageFlooding(jid: string): boolean {
  const now = Date.now();
  const timestamps = messageRateMap.get(jid) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (recent.length >= MESSAGE_RATE_LIMIT) {
    // Update the map with pruned timestamps so it doesn't grow unbounded
    messageRateMap.set(jid, recent);
    return true;
  }

  recent.push(now);
  messageRateMap.set(jid, recent);
  return false;
}

/**
 * Exposed for testing — clears the rate-limit map.
 */
export function clearRateLimitMapForTests(): void {
  messageRateMap.clear();
}

// Periodically prune stale JIDs to prevent memory leaks in long-running processes
setInterval(() => {
  const now = Date.now();
  for (const [jid, timestamps] of messageRateMap) {
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) {
      messageRateMap.delete(jid);
    } else {
      messageRateMap.set(jid, recent);
    }
  }
}, 5 * 60_000).unref(); // Every 5 minutes, unref so it doesn't keep the process alive
