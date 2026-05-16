import type { FastifyBaseLogger } from 'fastify';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { SessionManager } from './session-manager';
import { putPendingMedia, type MediaKind } from '../media-cache';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
};

// Window during which a media arrival waits for a follow-up text from the
// same JID. If a text lands within this window, the two get merged into a
// single dispatch ("Analyze esto" with the media sitting in cache), so the
// bot processes them as one turn with implicit consent instead of asking
// "¿querés que lo analice?" and then immediately analyzing on the next turn.
const MEDIA_DEBOUNCE_MS = 1500;
type PendingMediaDispatch = {
  timer: NodeJS.Timeout;
  pushName: string;
};
const pendingMediaDispatches = new Map<string, PendingMediaDispatch>();

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

        const isGroup = remoteJid.endsWith('@g.us');
        const isDm = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
        if (!isDm && !isGroup) {
          console.log(`[wa] drop: unsupported JID type ${remoteJid}`);
          continue;
        }

        const msgTypes = Object.keys(m.message ?? {}).filter((k) => k !== 'messageContextInfo');
        console.log(
          `[wa] ▶ message from=${remoteJid} group=${isGroup} types=[${msgTypes.join(',')}] pushName="${m.pushName ?? ''}"`,
        );

        if (isGroup) {
          const { phoneJid, lidJid } = input.sessionManager.getOwnJids();
          const mentioned = extractMentionedJids(m.message);
          const tagged = mentioned.some((j) => j === phoneJid || j === lidJid);
          if (!tagged) {
            console.log(`[wa] drop: group message without bot mention (mentions=${mentioned.join(',')})`);
            continue;
          }
          console.log('[wa] bot is tagged in group → processing');
        }

        const mediaRef = extractMedia(m);
        if (mediaRef) {
          console.log(
            `[wa] media detected: kind=${mediaRef.kind} source=${mediaRef.source} mime="${mediaRef.mimetype}" dur=${mediaRef.durationSec ?? '-'}s file="${mediaRef.fileName ?? ''}"`,
          );
          handleMedia(input, m, remoteJid, mediaRef).catch((err) => {
            console.error(`[wa] ✗ media handling failed: ${err instanceof Error ? err.message : err}`);
            input.log.error({ err }, 'media handling failed');
          });
          continue;
        }

        const text = extractText(m.message);
        if (!text) {
          console.log('[wa] drop: no extractable text and no media');
          continue;
        }

        const customerName = m.pushName ?? '';

        // If we're holding a pending media dispatch for this JID (debounce
        // window open), the user's follow-up text counts as implicit consent.
        // Cancel the debounce and dispatch the text — the media is already
        // cached, so the router/agent will see it and analyze in one turn.
        const pending = pendingMediaDispatches.get(remoteJid);
        if (pending) {
          clearTimeout(pending.timer);
          pendingMediaDispatches.delete(remoteJid);
          console.log(
            `[wa] merging pending media with follow-up text: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
          );
          input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
            console.error(`[wa] ✗ dispatchMessage failed: ${err instanceof Error ? err.message : err}`);
          });
          continue;
        }

        console.log(`[wa] → dispatching text: "${text.slice(0, 120).replace(/\n/g, ' ')}"`);
        input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
          console.error(`[wa] ✗ dispatchMessage failed: ${err instanceof Error ? err.message : err}`);
          input.log.error({ err }, 'dispatchMessage failed');
        });
      }
    },
  });
}

type MediaRef = {
  download: WAMessage;
  kind: MediaKind;
  mimetype: string;
  durationSec?: number;
  fileName?: string;
  source: 'direct' | 'quoted';
};

type WAMediaPayload = {
  audioMessage?: { mimetype?: string | null; seconds?: number | null } | null;
  imageMessage?: { mimetype?: string | null; caption?: string | null } | null;
  videoMessage?: {
    mimetype?: string | null;
    seconds?: number | null;
    caption?: string | null;
  } | null;
  documentMessage?: {
    mimetype?: string | null;
    fileName?: string | null;
    title?: string | null;
    caption?: string | null;
  } | null;
};

function extractFromPayload(p: WAMediaPayload | null | undefined): Omit<MediaRef, 'download' | 'source'> | null {
  if (!p) return null;
  if (p.audioMessage) {
    return {
      kind: 'audio',
      mimetype: p.audioMessage.mimetype ?? 'audio/ogg; codecs=opus',
      durationSec: p.audioMessage.seconds ?? 0,
    };
  }
  if (p.imageMessage) {
    return {
      kind: 'image',
      mimetype: p.imageMessage.mimetype ?? 'image/jpeg',
    };
  }
  if (p.videoMessage) {
    return {
      kind: 'video',
      mimetype: p.videoMessage.mimetype ?? 'video/mp4',
      durationSec: p.videoMessage.seconds ?? 0,
    };
  }
  if (p.documentMessage) {
    return {
      kind: 'document',
      mimetype: p.documentMessage.mimetype ?? 'application/octet-stream',
      fileName: p.documentMessage.fileName ?? p.documentMessage.title ?? undefined,
    };
  }
  return null;
}

function extractMedia(m: WAMessage): MediaRef | null {
  const directPayload = m.message as WAMediaPayload | null | undefined;
  const direct = extractFromPayload(directPayload);
  if (direct) {
    return { ...direct, download: m, source: 'direct' };
  }

  // Quoted-media envelope (user replied to a media message with a text that
  // mentions the bot). We reconstruct a stub WAMessage pointing at the
  // original media so the Baileys downloader can fetch its bytes.
  const ctx = (m.message as {
    extendedTextMessage?: {
      contextInfo?: {
        stanzaId?: string | null;
        participant?: string | null;
        quotedMessage?: WAMediaPayload | null;
      } | null;
    } | null;
  } | null)?.extendedTextMessage?.contextInfo;

  if (!ctx?.stanzaId || !ctx.quotedMessage) return null;
  const quoted = extractFromPayload(ctx.quotedMessage);
  if (!quoted) return null;

  const stub: WAMessage = {
    key: {
      remoteJid: m.key.remoteJid,
      id: ctx.stanzaId,
      fromMe: false,
      participant: ctx.participant ?? undefined,
    },
    message: ctx.quotedMessage as WAMessage['message'],
  } as WAMessage;

  return { ...quoted, download: stub, source: 'quoted' };
}

// Per-kind fallback dispatch text when no caption / follow-up text arrives.
// Mirrors the previous "(audio reenviado)" sentinel; the agent uses these to
// detect that a media-only message was forwarded.
function fallbackText(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return '(audio reenviado)';
    case 'image':
      return '(imagen reenviada)';
    case 'video':
      return '(video reenviado)';
    case 'document':
      return '(documento reenviado)';
  }
}

async function handleMedia(
  input: ConnectInput,
  m: WAMessage,
  remoteJid: string,
  media: MediaRef,
): Promise<void> {
  console.log(`[wa] downloading ${media.kind} (source=${media.source})...`);
  const t0 = Date.now();
  const buffer = await input.sessionManager.downloadMedia(media.download);
  console.log(`[wa] ✓ downloaded ${buffer.length} bytes in ${Date.now() - t0}ms`);

  putPendingMedia(remoteJid, {
    buffer,
    mimetype: media.mimetype,
    kind: media.kind,
    durationSec: media.durationSec,
    fileName: media.fileName,
    fromName: m.pushName ?? '',
    source: media.source,
  });
  console.log(`[wa] cached pending media for jid=${remoteJid} kind=${media.kind}`);

  const userText = extractText(m.message) ?? '';

  // If the media came with a caption, use it immediately. No debounce — the
  // user already said what they wanted in a single send.
  if (userText) {
    console.log(`[wa] media came with text → dispatching immediately: "${userText.replace(/\n/g, ' ')}"`);
    await input.dispatchMessage(remoteJid, m.pushName ?? '', userText);
    return;
  }

  // No caption: hold for MEDIA_DEBOUNCE_MS to see if a follow-up text lands.
  // Cancel any prior pending dispatch on this JID (later media overwrites
  // earlier one — only the latest gets dispatched).
  const prior = pendingMediaDispatches.get(remoteJid);
  if (prior) {
    clearTimeout(prior.timer);
    console.log('[wa] superseded prior pending media dispatch on same JID');
  }

  const sentinel = fallbackText(media.kind);
  console.log(`[wa] holding media for ${MEDIA_DEBOUNCE_MS}ms in case a follow-up text arrives...`);
  const pushName = m.pushName ?? '';
  const timer = setTimeout(() => {
    pendingMediaDispatches.delete(remoteJid);
    console.log(`[wa] debounce window elapsed with no follow-up → dispatching "${sentinel}"`);
    input
      .dispatchMessage(remoteJid, pushName, sentinel)
      .catch((err) => {
        console.error(`[wa] ✗ debounced dispatch failed: ${err instanceof Error ? err.message : err}`);
      });
  }, MEDIA_DEBOUNCE_MS);

  pendingMediaDispatches.set(remoteJid, { timer, pushName });
}

function extractMentionedJids(message: unknown): string[] {
  const m = message as {
    extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] | null } | null } | null;
  };
  return m.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
}

function extractText(message: unknown): string | null {
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string };
  };
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}
