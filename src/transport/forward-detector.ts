import type { WAMessage } from '@whiskeysockets/baileys';

export type ViralLevel = 'none' | 'low' | 'high';

export type ForwardInfo = {
  isForwarded: boolean;
  forwardingScore: number;
  viralLevel: ViralLevel;
};

/**
 * Walks through all known contextInfo locations in a Baileys WAMessage envelope
 * and returns the first contextInfo that indicates forwarding, or null.
 */
function extractContextInfo(msg: WAMessage): {
  isForwarded?: boolean | null;
  forwardingScore?: number | null;
} | null {
  const m = msg.message;
  if (!m) return null;

  // Check every known message type that can carry contextInfo.
  const candidates = [
    (m as Record<string, unknown>).extendedTextMessage,
    (m as Record<string, unknown>).imageMessage,
    (m as Record<string, unknown>).videoMessage,
    (m as Record<string, unknown>).audioMessage,
    (m as Record<string, unknown>).documentMessage,
    (m as Record<string, unknown>).stickerMessage,
    (m as Record<string, unknown>).locationMessage,
    (m as Record<string, unknown>).contactMessage,
    (m as Record<string, unknown>).liveLocationMessage,
  ] as Array<{ contextInfo?: { isForwarded?: boolean | null; forwardingScore?: number | null } } | null | undefined>;

  for (const candidate of candidates) {
    if (candidate?.contextInfo?.isForwarded != null) {
      return candidate.contextInfo;
    }
    // Also surface contextInfo that has a forwardingScore even if isForwarded is missing.
    if (candidate?.contextInfo?.forwardingScore != null) {
      return candidate.contextInfo;
    }
  }

  return null;
}

/**
 * Classifies the viral level of a forwarded message based on its forwardingScore:
 *   - score >= 5, OR isForwarded=true with no score  → 'high'
 *   - score >= 2                                      → 'low'
 *   - score === 1                                     → 'low'   (forwarded once — low noise)
 *   - not forwarded                                   → 'none'
 */
function classifyViralLevel(isForwarded: boolean, score: number): ViralLevel {
  if (!isForwarded) return 'none';
  if (score === 0) return 'high'; // isForwarded=true but no score — treat as highly viral
  if (score >= 5) return 'high';
  if (score >= 2) return 'low';
  return 'low'; // score === 1 → forwarded once
}

/**
 * Detects whether a Baileys WAMessage was forwarded and classifies its virality.
 *
 * @param msg - A Baileys WAMessage from a `messages.upsert` event.
 * @returns ForwardInfo with isForwarded, forwardingScore (0 if unknown), and viralLevel.
 */
export function detectForwarding(msg: WAMessage): ForwardInfo {
  const ctx = extractContextInfo(msg);

  if (!ctx) {
    return { isForwarded: false, forwardingScore: 0, viralLevel: 'none' };
  }

  const isForwarded = ctx.isForwarded === true || (ctx.forwardingScore != null && ctx.forwardingScore > 0);
  const forwardingScore = ctx.forwardingScore ?? 0;
  const viralLevel = classifyViralLevel(isForwarded, forwardingScore);

  return { isForwarded, forwardingScore, viralLevel };
}
