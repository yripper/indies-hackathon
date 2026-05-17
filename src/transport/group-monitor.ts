/**
 * Group Auto-Monitoring Module
 *
 * When the bot is added to a WhatsApp group, this module decides whether
 * an incoming message should be automatically queued for analysis — without
 * the user explicitly mentioning the bot.
 *
 * Enable via ENV:  GROUP_MONITOR_ENABLED=true
 *
 * Rate limit: 10 analyses per hour per group JID (more aggressive than the
 * per-individual limit of 5/hour that the deepfake tools enforce internally).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisType = 'audio' | 'image' | 'video' | 'url' | 'factcheck' | 'none';

export type AutoAnalyzeResult = {
  analyze: boolean;
  type: AnalysisType;
  /** Human-readable explanation of why (or why not) this message was queued. */
  reason: string;
  /** The auto-injected instruction to pass to the LLM when analyze=true. */
  instruction?: string;
};

/**
 * Minimal shape of a Baileys WAMessage that we care about.
 * We use `unknown` casts internally so callers can pass the real type without
 * importing Baileys in tests.
 */
export type MonitorableMessage = {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
  };
  message?: unknown;
  pushName?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Video platform URL detection
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_PLATFORM_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
  'instagram.com',
  'www.instagram.com',
]);

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

function extractVideoPlatformUrl(text: string): string | null {
  const matches = text.match(URL_PATTERN);
  if (!matches) return null;
  for (const raw of matches) {
    try {
      const url = new URL(raw);
      if (VIDEO_PLATFORM_HOSTS.has(url.hostname)) return raw;
    } catch {
      // malformed URL — skip
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message shape helpers
// ─────────────────────────────────────────────────────────────────────────────

type BaileysMessageContent = {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
    contextInfo?: { isForwarded?: boolean; forwardingScore?: number };
  };
  imageMessage?: { caption?: string };
  audioMessage?: { url?: string };
  videoMessage?: { caption?: string };
};

function getContent(msg: MonitorableMessage): BaileysMessageContent {
  return (msg.message ?? {}) as BaileysMessageContent;
}

function isAudioMessage(msg: MonitorableMessage): boolean {
  return !!(getContent(msg).audioMessage);
}

function isImageMessage(msg: MonitorableMessage): boolean {
  return !!(getContent(msg).imageMessage);
}

function isVideoMessage(msg: MonitorableMessage): boolean {
  return !!(getContent(msg).videoMessage);
}

function extractText(msg: MonitorableMessage): string | null {
  const c = getContent(msg);
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    null
  );
}

/**
 * A message is considered "forwarded" when Baileys sets contextInfo.isForwarded
 * or when the forwarding score is non-zero (WA sets score ≥ 1 on forwarded msgs).
 */
function isForwarded(msg: MonitorableMessage): boolean {
  const ctx = getContent(msg).extendedTextMessage?.contextInfo;
  if (!ctx) return false;
  return !!(ctx.isForwarded) || (ctx.forwardingScore ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-group rate limiter (in-memory; resets on restart — fine for MVP)
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000; // 1 hour
const GROUP_RATE_LIMIT_MAX = 10; // analyses per group per hour

type RateLimitBucket = { count: number; windowStart: number };
const rateLimitStore = new Map<string, RateLimitBucket>();

/**
 * Returns true if this group is still within its allowed quota.
 * Increments the counter as a side-effect when allowed.
 */
export function checkGroupRateLimit(groupJid: string): boolean {
  const now = Date.now();
  const existing = rateLimitStore.get(groupJid);

  if (!existing || now - existing.windowStart > GROUP_RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(groupJid, { count: 1, windowStart: now });
    return true;
  }

  if (existing.count >= GROUP_RATE_LIMIT_MAX) return false;

  existing.count += 1;
  return true;
}

/** Exposed for testing — resets all rate-limit buckets. */
export function resetGroupRateLimits(): void {
  rateLimitStore.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag
// ─────────────────────────────────────────────────────────────────────────────

export function isGroupMonitorEnabled(): boolean {
  return process.env.GROUP_MONITOR_ENABLED === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core decision function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decides whether a message arriving in a WhatsApp group should be
 * automatically sent for analysis.
 *
 * Guards applied (in order):
 *   1. Feature flag — disabled → {analyze:false}
 *   2. JID must end in @g.us
 *   3. Skip bot's own messages (fromMe=true)
 *   4. Skip status broadcast JID
 *   5. Detect media type → queue appropriate analysis
 *   6. Detect video-platform URL in text → queue scan_url_deepfake
 *   7. Detect forwarded plain text (>20 chars) → queue fact-check
 *   8. Rate limit per group
 */
export function shouldAutoAnalyze(
  msg: MonitorableMessage,
  jid: string,
): AutoAnalyzeResult {
  const NO = (reason: string): AutoAnalyzeResult => ({ analyze: false, type: 'none', reason });

  // 1. Feature flag
  if (!isGroupMonitorEnabled()) {
    return NO('group monitoring disabled');
  }

  // 2. Must be a group JID
  if (!jid.endsWith('@g.us')) {
    return NO('not a group message');
  }

  // 3. Skip bot's own messages
  if (msg.key.fromMe) {
    return NO('own message');
  }

  // 4. Skip broadcast
  if (jid === 'status@broadcast') {
    return NO('status broadcast');
  }

  // Determine the analysis type before consuming a rate-limit slot.
  let type: AnalysisType = 'none';
  let instruction: string | undefined;

  if (isAudioMessage(msg)) {
    type = 'audio';
    instruction =
      'Un participante del grupo compartió un audio. Analízalo automáticamente con analyze_audio_deepfake para detectar si es una voz generada por IA o un deepfake.';
  } else if (isImageMessage(msg)) {
    type = 'image';
    instruction =
      'Un participante del grupo compartió una imagen. Analízala automáticamente con analyze_image_deepfake para detectar si es sintética o manipulada.';
  } else if (isVideoMessage(msg)) {
    type = 'video';
    const caption = extractText(msg);
    instruction = caption
      ? `Un participante del grupo compartió un video con caption: "${caption}". Analízalo automáticamente con detect_deepfake_video.`
      : 'Un participante del grupo compartió un video. Analízalo automáticamente con detect_deepfake_video para detectar deepfakes.';
  } else {
    // Text-only path
    const text = extractText(msg);
    if (text) {
      const videoPlatformUrl = extractVideoPlatformUrl(text);
      if (videoPlatformUrl) {
        type = 'url';
        instruction = `Un participante del grupo compartió este enlace de video: ${videoPlatformUrl}. Analízalo automáticamente con scan_url_deepfake.`;
      } else if (isForwarded(msg) && text.length > 20) {
        type = 'factcheck';
        instruction = `Un participante del grupo reenvió este mensaje: "${text}". Verifica automáticamente si es desinformación usando verificar_noticia.`;
      }
    }
  }

  if (type === 'none') {
    return NO('no actionable content detected');
  }

  // 5. Rate limit — consume slot only after we've confirmed there's something to analyze
  if (!checkGroupRateLimit(jid)) {
    return NO(`rate limit reached for group ${jid} (max ${GROUP_RATE_LIMIT_MAX}/hour)`);
  }

  return { analyze: true, type, reason: `auto-detected ${type} in group`, instruction };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiet-mode verdict filter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In quiet mode the bot only sends a reply when the analysis flags something
 * suspicious. Returns true when the reply text warrants alerting the group.
 *
 * Verdicts that trigger an alert:  FAKE, UNCERTAIN, or any forwarded content
 * (fact-check always gets surfaced so the group knows it was checked).
 */
export function shouldSendGroupAlert(replyText: string, analysisType: AnalysisType): boolean {
  if (analysisType === 'factcheck') return true;

  const upper = replyText.toUpperCase();
  return upper.includes('FAKE') || upper.includes('UNCERTAIN') || upper.includes('FALSO');
}
