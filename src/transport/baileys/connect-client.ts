import type { FastifyBaseLogger } from 'fastify';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import type { SessionManager } from './session-manager';
import type { MediaStore } from '../media-store';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
  mediaStore: MediaStore;
  /**
   * Base URL the agent will use to fetch attachments back from this server,
   * e.g. "http://127.0.0.1:3000". The agent always talks to itself, so a
   * loopback address is fine.
   */
  publicBaseUrl: string;
};

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

        const messageKeys = Object.keys(m.message);
        const messageType = detectMessageType(m.message);

        // Accept DMs (@s.whatsapp.net) and Baileys 7 @lid identifiers (privacy-mode users).
        const isDm = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
        if (!isDm) {
          input.log.debug({ remoteJid, messageType }, 'WA inbound: skipped non-DM');
          continue;
        }

        void handleOne(input, m, remoteJid, messageType, messageKeys);
      }
    },
  });
}

async function handleOne(
  input: ConnectInput,
  m: WAMessage,
  remoteJid: string,
  messageType: string,
  messageKeys: string[],
): Promise<void> {
  const caption = extractText(m.message);
  const customerName = m.pushName ?? '';

  // If this carries an image, download it and synthesize a URL the agent
  // can hand to its image-detection tools.
  const imageMimeType =
    (m.message?.imageMessage?.mimetype as string | undefined) ?? null;

  let attachmentUrl: string | null = null;
  if (imageMimeType) {
    try {
      const buffer = (await downloadMediaMessage(m, 'buffer', {})) as Buffer;
      const entry = input.mediaStore.put(buffer, imageMimeType);
      attachmentUrl = `${input.publicBaseUrl}/v1/media/${entry.id}`;
      input.log.info(
        {
          remoteJid,
          mediaId: entry.id,
          mimeType: imageMimeType,
          byteLength: buffer.byteLength,
          attachmentUrl,
        },
        'WA inbound: image downloaded and registered',
      );
    } catch (err) {
      input.log.error(
        { err, remoteJid, mimeType: imageMimeType },
        'WA inbound: image download FAILED',
      );
    }
  }

  // Build the text we hand to the agent. If we have an attachment URL,
  // inject it so the LLM can pass it to the tools. If the message had no
  // caption either, synthesize one so the agent has something to act on
  // instead of silently dropping the turn.
  let dispatchText: string | null = null;
  if (caption && attachmentUrl) {
    dispatchText = `${caption}\n\n[Imagen adjunta: ${attachmentUrl}]`;
  } else if (attachmentUrl) {
    dispatchText = `El usuario adjuntó una imagen sin texto. Analízala usando las tools disponibles.\n\n[Imagen adjunta: ${attachmentUrl}]`;
  } else if (caption) {
    dispatchText = caption;
  }

  if (!dispatchText) {
    input.log.warn(
      { remoteJid, messageType, messageKeys, pushName: m.pushName },
      'WA inbound: dropped — no text and no supported attachment',
    );
    return;
  }

  input.log.info(
    {
      remoteJid,
      messageType,
      messageKeys,
      customerName,
      hasAttachment: attachmentUrl !== null,
      attachmentUrl,
      textPreview: dispatchText.slice(0, 200),
      textLength: dispatchText.length,
    },
    'WA inbound: dispatching to agent',
  );
  try {
    await input.dispatchMessage(remoteJid, customerName, dispatchText);
  } catch (err) {
    input.log.error({ err, remoteJid }, 'dispatchMessage failed');
  }
}

type BaileysMessageShape = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string };
  videoMessage?: { caption?: string };
  audioMessage?: unknown;
  stickerMessage?: unknown;
  documentMessage?: { caption?: string };
  contactMessage?: unknown;
  locationMessage?: unknown;
  reactionMessage?: unknown;
};

function detectMessageType(message: unknown): string {
  const m = message as BaileysMessageShape;
  if (m.conversation != null) return 'text';
  if (m.extendedTextMessage != null) return 'text_extended';
  if (m.imageMessage != null) return 'image';
  if (m.videoMessage != null) return 'video';
  if (m.audioMessage != null) return 'audio';
  if (m.stickerMessage != null) return 'sticker';
  if (m.documentMessage != null) return 'document';
  if (m.contactMessage != null) return 'contact';
  if (m.locationMessage != null) return 'location';
  if (m.reactionMessage != null) return 'reaction';
  return 'unknown';
}

function extractText(message: unknown): string | null {
  const m = message as BaileysMessageShape;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}
