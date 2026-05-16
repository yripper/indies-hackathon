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
        // v0: only direct messages (@s.whatsapp.net). Skip groups/broadcast/status/lid.
        if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

        const text = extractText(m.message);
        if (!text) continue;

        const customerPhone = remoteJid;
        const customerName = m.pushName ?? '';
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
