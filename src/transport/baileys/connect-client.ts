import type { FastifyBaseLogger } from 'fastify';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { SessionManager } from './session-manager';
import { putPendingAudio } from '../audio-cache';
import { putPendingImage } from '../image-cache';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
};

// Window during which an audio arrival waits for a follow-up text from the
// same JID. If a text lands within this window, the two get merged into a
// single dispatch ("Analyze este audio" with the audio sitting in cache),
// so the bot processes them as one turn with implicit consent instead of
// asking "¿querés que lo analice?" and then immediately analyzing on the
// next turn.
const AUDIO_DEBOUNCE_MS = 1500;
type PendingAudioDispatch = {
  timer: NodeJS.Timeout;
  pushName: string;
};
const pendingAudioDispatches = new Map<string, PendingAudioDispatch>();

const IMAGE_DEBOUNCE_MS = 1500;
type PendingImageDispatch = {
  timer: NodeJS.Timeout;
  pushName: string;
};
const pendingImageDispatches = new Map<string, PendingImageDispatch>();

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
          continue;
        }

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

        const audioRef = extractAudio(m);
        if (audioRef) {
          console.log(
            `[wa] audio detected: source=${audioRef.source} mime="${audioRef.mimetype}" dur=${audioRef.durationSec}s`,
          );
          handleAudio(input, m, remoteJid, audioRef).catch((err) => {
            console.error(`[wa] ✗ audio handling failed: ${err instanceof Error ? err.message : err}`);
            input.log.error({ err }, 'audio handling failed');
          });
          continue;
        }

        const imageRef = extractImage(m);
        if (imageRef) {
          console.log(`[wa] image detected: source=${imageRef.source} mime="${imageRef.mimetype}"`);
          handleImage(input, m, remoteJid, imageRef).catch((err) => {
            console.error(`[wa] ✗ image handling failed: ${err instanceof Error ? err.message : err}`);
          });
          continue;
        }

        const text = extractText(m.message);
        if (!text) {
          console.log('[wa] drop: no extractable text and no audio');
          continue;
        }

        const customerName = m.pushName ?? '';

        // If we're holding a pending audio dispatch for this JID (debounce
        // window open), the user's follow-up text counts as implicit consent.
        // Cancel the debounce and dispatch the text — the audio is already
        // cached, so the router/agent will see it and analyze in one turn.
        const pending = pendingAudioDispatches.get(remoteJid);
        if (pending) {
          clearTimeout(pending.timer);
          pendingAudioDispatches.delete(remoteJid);
          console.log(
            `[wa] merging pending audio with follow-up text: "${text.slice(0, 120).replace(/\n/g, ' ')}"`,
          );
          input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
            console.error(`[wa] ✗ dispatchMessage failed: ${err instanceof Error ? err.message : err}`);
          });
          continue;
        }

        // Check pending image dispatch (same pattern as audio)
        const pendingImg = pendingImageDispatches.get(remoteJid);
        if (pendingImg) {
          clearTimeout(pendingImg.timer);
          pendingImageDispatches.delete(remoteJid);
          console.log(`[wa] merging pending image with follow-up text: "${text.slice(0, 120)}"`);
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

type AudioRef = {
  download: WAMessage;
  mimetype: string;
  durationSec: number;
  source: 'direct' | 'quoted';
};

function extractAudio(m: WAMessage): AudioRef | null {
  const direct = (m.message as { audioMessage?: { mimetype?: string; seconds?: number } | null } | null)
    ?.audioMessage;
  if (direct) {
    return {
      download: m,
      mimetype: direct.mimetype ?? 'audio/ogg; codecs=opus',
      durationSec: direct.seconds ?? 0,
      source: 'direct',
    };
  }

  const ctx = (m.message as {
    extendedTextMessage?: {
      contextInfo?: {
        stanzaId?: string | null;
        participant?: string | null;
        quotedMessage?: { audioMessage?: { mimetype?: string; seconds?: number } | null } | null;
      } | null;
    } | null;
  } | null)?.extendedTextMessage?.contextInfo;

  const quotedAudio = ctx?.quotedMessage?.audioMessage;
  if (!quotedAudio || !ctx?.stanzaId) return null;

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
    mimetype: quotedAudio.mimetype ?? 'audio/ogg; codecs=opus',
    durationSec: quotedAudio.seconds ?? 0,
    source: 'quoted',
  };
}

async function handleAudio(
  input: ConnectInput,
  m: WAMessage,
  remoteJid: string,
  audio: AudioRef,
): Promise<void> {
  console.log(`[wa] downloading audio (source=${audio.source})...`);
  const t0 = Date.now();
  const buffer = await input.sessionManager.downloadMedia(audio.download);
  console.log(`[wa] ✓ downloaded ${buffer.length} bytes in ${Date.now() - t0}ms`);

  putPendingAudio(remoteJid, {
    buffer,
    mimetype: audio.mimetype,
    durationSec: audio.durationSec,
    fromName: m.pushName ?? '',
    source: audio.source,
  });
  console.log(`[wa] cached pending audio for jid=${remoteJid}`);

  const userText = extractText(m.message) ?? '';

  // If the audio came with a caption (rare for WhatsApp audio, but possible for
  // some clients), use it immediately. No debounce — the user already said
  // what they wanted in a single send.
  if (userText) {
    console.log(`[wa] audio came with text → dispatching immediately: "${userText.replace(/\n/g, ' ')}"`);
    await input.dispatchMessage(remoteJid, m.pushName ?? '', userText);
    return;
  }

  // No caption: hold for AUDIO_DEBOUNCE_MS to see if a follow-up text lands.
  // Cancel any prior pending dispatch on this JID (later audio overwrites
  // earlier one — only the latest gets dispatched).
  const prior = pendingAudioDispatches.get(remoteJid);
  if (prior) {
    clearTimeout(prior.timer);
    console.log('[wa] superseded prior pending audio dispatch on same JID');
  }

  console.log(`[wa] holding audio for ${AUDIO_DEBOUNCE_MS}ms in case a follow-up text arrives...`);
  const pushName = m.pushName ?? '';
  const timer = setTimeout(() => {
    pendingAudioDispatches.delete(remoteJid);
    console.log('[wa] debounce window elapsed with no follow-up → dispatching "(audio reenviado)"');
    input
      .dispatchMessage(remoteJid, pushName, '(audio reenviado)')
      .catch((err) => {
        console.error(`[wa] ✗ debounced dispatch failed: ${err instanceof Error ? err.message : err}`);
      });
  }, AUDIO_DEBOUNCE_MS);

  pendingAudioDispatches.set(remoteJid, { timer, pushName });
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
    return { download: m, mimetype: direct.mimetype ?? 'image/jpeg', source: 'direct' };
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
    key: { remoteJid: m.key.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant ?? undefined },
    message: ctx.quotedMessage as WAMessage['message'],
  } as WAMessage;

  return { download: stub, mimetype: quotedImage.mimetype ?? 'image/jpeg', source: 'quoted' };
}

async function handleImage(
  input: ConnectInput,
  m: WAMessage,
  remoteJid: string,
  image: ImageRef,
): Promise<void> {
  console.log(`[wa] downloading image (source=${image.source})...`);
  const t0 = Date.now();
  const buffer = await input.sessionManager.downloadMedia(image.download);
  console.log(`[wa] ✓ downloaded image ${buffer.length} bytes in ${Date.now() - t0}ms`);

  putPendingImage(remoteJid, {
    buffer,
    mimetype: image.mimetype,
    bytes: buffer.length,
    fromName: m.pushName ?? '',
    source: image.source,
  });

  const userText = extractText(m.message) ?? '';

  if (userText) {
    console.log(`[wa] image with caption → dispatching immediately: "${userText.slice(0, 120)}"`);
    await input.dispatchMessage(remoteJid, m.pushName ?? '', userText);
    return;
  }

  const prior = pendingImageDispatches.get(remoteJid);
  if (prior) {
    clearTimeout(prior.timer);
  }

  console.log(`[wa] holding image for ${IMAGE_DEBOUNCE_MS}ms for follow-up text...`);
  const pushName = m.pushName ?? '';
  const timer = setTimeout(() => {
    pendingImageDispatches.delete(remoteJid);
    console.log('[wa] image debounce elapsed → dispatching "(imagen recibida)"');
    input.dispatchMessage(remoteJid, pushName, '(imagen recibida)').catch((err) => {
      console.error(`[wa] ✗ image debounced dispatch failed: ${err instanceof Error ? err.message : err}`);
    });
  }, IMAGE_DEBOUNCE_MS);

  pendingImageDispatches.set(remoteJid, { timer, pushName });
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
  };
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  );
}
