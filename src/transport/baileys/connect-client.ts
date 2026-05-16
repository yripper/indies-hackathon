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
      input.log.info({ count: upsert.messages.length, type: upsert.type }, 'baileys upsert');
      for (const m of upsert.messages) {
        const remoteJid = m.key.remoteJid;
        const fromMe = m.key.fromMe;
        const msgTypes = m.message ? Object.keys(m.message) : [];
        input.log.info({ remoteJid, fromMe, pushName: m.pushName, msgTypes }, 'baileys message');

        if (!m.message) {
          input.log.info('skip: no m.message');
          continue;
        }
        if (fromMe) {
          input.log.info('skip: fromMe');
          continue;
        }
        if (!remoteJid) {
          input.log.info('skip: no remoteJid');
          continue;
        }
        // Accept DMs (@s.whatsapp.net) and Baileys 7 @lid identifiers (privacy-mode users)
        const isDm = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
        if (!isDm) {
          input.log.info({ remoteJid }, 'skip: not a DM (group/broadcast/status)');
          continue;
        }

        const text = extractText(m.message);
        if (!text) {
          input.log.info({ msgTypes }, 'skip: no text extracted');
          continue;
        }

        const customerPhone = remoteJid;
        const customerName = m.pushName ?? '';
        input.log.info({ customerPhone, customerName, textPreview: text.slice(0, 60) }, 'dispatching message');
        input.dispatchMessage(customerPhone, customerName, text).catch((err) => {
          input.log.error({ err }, 'dispatchMessage failed');
        });
      }
    },
  });
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
