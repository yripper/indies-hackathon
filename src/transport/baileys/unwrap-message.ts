import type { WAMessage } from '@whiskeysockets/baileys';

/**
 * Baileys wraps certain message types in container envelopes:
 * - viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension
 * - ephemeralMessage
 * - documentWithCaptionMessage
 *
 * This function peels off these wrappers to expose the inner content message
 * (imageMessage, audioMessage, videoMessage, etc.) for uniform extraction.
 */
export function unwrapMessage(message: WAMessage['message']): WAMessage['message'] {
  if (!message) return message;

  const m = message as Record<string, unknown>;

  // viewOnce variants
  const viewOnce = (m.viewOnceMessage ?? m.viewOnceMessageV2 ?? m.viewOnceMessageV2Extension) as
    | { message?: WAMessage['message'] }
    | undefined;
  if (viewOnce?.message) return viewOnce.message;

  // ephemeral
  const ephemeral = m.ephemeralMessage as { message?: WAMessage['message'] } | undefined;
  if (ephemeral?.message) return ephemeral.message;

  // documentWithCaption (sometimes wraps images sent as documents)
  const docCaption = m.documentWithCaptionMessage as { message?: WAMessage['message'] } | undefined;
  if (docCaption?.message) return docCaption.message;

  return message;
}
