import type { FastifyBaseLogger } from 'fastify';
import type { SessionManager } from './session-manager';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
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

        const text = extractText(m.message);
        if (!text) {
          input.log.warn(
            { remoteJid, messageType, messageKeys, pushName: m.pushName },
            'WA inbound: dropped — no text content (attachment without caption?)',
          );
          continue;
        }

        const customerName = m.pushName ?? '';
        input.log.info(
          {
            remoteJid,
            messageType,
            messageKeys,
            customerName,
            textPreview: text.slice(0, 200),
            textLength: text.length,
          },
          'WA inbound: dispatching to agent',
        );
        input.dispatchMessage(remoteJid, customerName, text).catch((err) => {
          input.log.error({ err, remoteJid }, 'dispatchMessage failed');
        });
      }
    },
  });
}

type BaileysMessage = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  audioMessage?: unknown;
  stickerMessage?: unknown;
  documentMessage?: { caption?: string };
  contactMessage?: unknown;
  locationMessage?: unknown;
  reactionMessage?: unknown;
};

function detectMessageType(message: unknown): string {
  const m = message as BaileysMessage;
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
  const m = message as BaileysMessage;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}
