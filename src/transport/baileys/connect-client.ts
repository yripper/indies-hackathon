import type { FastifyBaseLogger } from 'fastify';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import type { SessionManager } from './session-manager';
import { putPendingImage, peekPendingImage } from '../image-cache';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
};

// Window during which an image arrival waits for a follow-up text from the
// same JID. If a text lands within this window, the two get merged into a
// single dispatch ("¿es real?" with the image sitting in cache), so the bot
// processes them as one turn with implicit consent instead of asking "¿querés
// que la analice?" and then re-prompting on the next turn.
const IMAGE_DEBOUNCE_MS = 1500;
type PendingImageDispatch = {
  timer: NodeJS.Timeout;
  pushName: string;
};
const pendingImageDispatches = new Map<string, PendingImageDispatch>();

// WhatsApp / Baileys sometimes redelivers the same physical message — e.g.
// when the user has multiple paired devices, or on resync. The same image
// arrives as two messages.upsert events with the same m.key.id. Without
// dedup, the second arrival starts a debounce that fires "(imagen recibida)"
// 1.5s AFTER the first arrival's caption was already dispatched, producing
// a confusing second bot reply asking for confirmation.
const SEEN_MESSAGE_IDS_MAX = 1000;
const seenMessageIds = new Set<string>();
function alreadySeen(id: string | null | undefined): boolean {
  if (!id) return false;
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  if (seenMessageIds.size > SEEN_MESSAGE_IDS_MAX) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest) seenMessageIds.delete(oldest);
  }
  return false;
}

export async function connectClient(input: ConnectInput): Promise<void> {
  await input.sessionManager.createSession({
    sessionsDir: input.sessionsDir,
    onQr: input.onQr,
    onConnected: input.onConnected,
    onDisconnected: input.onDisconnected,
    onMessage: (upsert) => {
      for (const m of upsert.messages) {
        if (!m.message) continue;
        if (m.key.fromMe) continue;
        const remoteJid = m.key.remoteJid;
        if (!remoteJid) continue;

        if (alreadySeen(m.key.id)) {
          input.log.debug({ remoteJid, messageId: m.key.id }, 'wa: drop duplicate message id');
          continue;
        }

        const isGroup = remoteJid.endsWith('@g.us');
        const isDm = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
        if (!isDm && !isGroup) {
          input.log.debug({ remoteJid }, 'wa: drop unsupported JID type');
          continue;
        }

        const imageRef = extractImage(m);

        // Groups: react to images, to text follow-ups while an image is
        // still cached (user replying to the bot's own "¿analizo?" prompt),
        // and to text that @mentions the bot. Plain group chatter that
        // matches none of those stays silently ignored so the bot doesn't
        // spam busy groups.
        if (isGroup && !imageRef) {
          const hasPendingImage = peekPendingImage(remoteJid) !== null;
          const { phoneJid, lidJid } = input.sessionManager.getOwnJids();
          const mentioned = extractMentionedJids(m.message);
          const isMentioned = mentioned.some((j) => j === phoneJid || j === lidJid);
          if (!hasPendingImage && !isMentioned) {
            input.log.debug({ remoteJid, mentioned }, 'wa: drop group text (no pending image, not mentioned)');
            continue;
          }
          input.log.info(
            { remoteJid, reason: isMentioned ? 'mentioned' : 'pending-image' },
            'wa: group text allowed',
          );
        }

        if (imageRef) {
          input.log.info(
            {
              remoteJid,
              isGroup,
              source: imageRef.source,
              mimetype: imageRef.mimetype,
            },
            'wa: image detected',
          );
          handleImage(input, m, remoteJid, imageRef).catch((err) => {
            input.log.error({ err, remoteJid }, 'wa: image handling failed');
          });
          continue;
        }

        const text = extractText(m.message);
        if (!text) {
          input.log.debug({ remoteJid }, 'wa: drop no extractable text and no image');
          continue;
        }

        const customerName = m.pushName ?? '';

        // Follow-up text merges with a pending image dispatch on the same JID
        // (debounce window still open) — cancel the debounce so the text
        // becomes the implicit-consent prompt for the cached image.
        const pending = pendingImageDispatches.get(remoteJid);
        if (pending) {
          clearTimeout(pending.timer);
          pendingImageDispatches.delete(remoteJid);
          input.log.info(
            { remoteJid, textPreview: text.slice(0, 120) },
            'wa: merging pending image with follow-up text',
          );
          input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
            input.log.error({ err, remoteJid }, 'wa: dispatchMessage failed');
          });
          continue;
        }

        input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
          input.log.error({ err, remoteJid }, 'wa: dispatchMessage failed');
        });
      }
    },
  });
}

type ImageRef = {
  download: WAMessage;
  mimetype: string;
  source: 'direct' | 'quoted';
};

function extractImage(m: WAMessage): ImageRef | null {
  const direct = (m.message as { imageMessage?: { mimetype?: string } | null } | null)
    ?.imageMessage;
  if (direct) {
    return {
      download: m,
      mimetype: direct.mimetype ?? 'image/jpeg',
      source: 'direct',
    };
  }

  const ctx = (m.message as {
    extendedTextMessage?: {
      contextInfo?: {
        stanzaId?: string | null;
        participant?: string | null;
        quotedMessage?: { imageMessage?: { mimetype?: string } | null } | null;
      } | null;
    } | null;
  } | null)?.extendedTextMessage?.contextInfo;

  const quotedImage = ctx?.quotedMessage?.imageMessage;
  if (!quotedImage || !ctx?.stanzaId) return null;

  const stub: WAMessage = {
    key: {
      remoteJid: m.key.remoteJid,
      id: ctx.stanzaId,
      fromMe: false,
      participant: ctx.participant ?? undefined,
    },
    message: ctx.quotedMessage as WAMessage['message'],
  } as WAMessage;

  return {
    download: stub,
    mimetype: quotedImage.mimetype ?? 'image/jpeg',
    source: 'quoted',
  };
}

async function handleImage(
  input: ConnectInput,
  m: WAMessage,
  remoteJid: string,
  image: ImageRef,
): Promise<void> {
  const t0 = Date.now();
  const buffer = await downloadMediaMessage(image.download, 'buffer', {});
  input.log.info(
    {
      remoteJid,
      bytes: buffer.length,
      mimetype: image.mimetype,
      source: image.source,
      downloadMs: Date.now() - t0,
    },
    'wa: image downloaded',
  );

  putPendingImage(remoteJid, {
    buffer,
    mimetype: image.mimetype,
    bytes: buffer.length,
    fromName: m.pushName ?? '',
    source: image.source,
  });
  input.log.info({ remoteJid }, 'wa: image cache put');

  const userText = extractText(m.message) ?? '';
  const customerName = m.pushName ?? '';

  // Image came with a caption — dispatch immediately, the user already said
  // what they wanted in one send.
  if (userText) {
    input.log.info(
      { remoteJid, captionPreview: userText.slice(0, 120) },
      'wa: image with caption → immediate dispatch',
    );
    await input.dispatchMessage(remoteJid, customerName, userText);
    return;
  }

  // No caption: hold for IMAGE_DEBOUNCE_MS to see if a follow-up text lands.
  // Later image on the same JID supersedes earlier debounced dispatch.
  const prior = pendingImageDispatches.get(remoteJid);
  if (prior) {
    clearTimeout(prior.timer);
    input.log.debug({ remoteJid }, 'wa: superseded prior pending image dispatch');
  }

  const pushName = m.pushName ?? '';
  const timer = setTimeout(() => {
    pendingImageDispatches.delete(remoteJid);
    input.log.info(
      { remoteJid },
      'wa: debounce elapsed with no follow-up → dispatching "(imagen recibida)"',
    );
    input.dispatchMessage(remoteJid, pushName, '(imagen recibida)').catch((err) => {
      input.log.error({ err, remoteJid }, 'wa: debounced dispatch failed');
    });
  }, IMAGE_DEBOUNCE_MS);

  pendingImageDispatches.set(remoteJid, { timer, pushName });
}

// WhatsApp puts @mention targets in extendedTextMessage.contextInfo.mentionedJid
// (and in imageMessage.contextInfo for captioned images, but those bypass this
// check entirely since they go through the image flow). Returns an empty array
// when there's no mention metadata so the caller can treat "no mentions" and
// "no contextInfo at all" identically.
function extractMentionedJids(message: unknown): string[] {
  const m = message as {
    extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] | null } | null } | null;
  } | null;
  return m?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
}

function extractText(message: unknown): string | null {
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
  };
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  );
}
