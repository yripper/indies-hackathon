import type { SessionManager } from './session-manager';

function toJid(to: string): string {
  if (to.includes('@')) return to;
  // Strip leading + and any non-digits, then add @s.whatsapp.net
  const digits = to.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

export function createSender(sessionManager: SessionManager) {
  return {
    async send(to: string, text: string): Promise<void> {
      await sessionManager.sendMessage(toJid(to), text);
    },
    async sendImage(to: string, imageBuffer: Buffer, caption?: string): Promise<void> {
      await sessionManager.sendImage(toJid(to), imageBuffer, caption);
    },
  };
}

export type Sender = ReturnType<typeof createSender>;
