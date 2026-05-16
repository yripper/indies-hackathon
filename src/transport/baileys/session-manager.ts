import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { useEncryptedAuthState } from './encrypted-auth-state';
import { EncryptedFileSessionStore } from '../../security/session-store';
import type { SessionCrypto } from '../../security/session-crypto';

const RECONNECT_DELAY_MS = 5_000;

type MessageHandler = (message: BaileysEventMap['messages.upsert']) => void;

export type SessionConfig = {
  sessionsDir: string;
  onMessage: MessageHandler;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
};

// Minimal noop logger to silence Baileys' default pino-to-stdout output,
// which would otherwise interleave with Fastify's structured JSON logs.
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLogger,
  level: 'silent',
};

export class SessionManager {
  private socket: WASocket | null = null;
  private currentConfig: SessionConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly crypto: SessionCrypto) {}

  hasSession(): boolean {
    return this.socket !== null;
  }

  // Bot's own JIDs (phone-number form and @lid form). Both are needed to detect
  // mentions in groups — Baileys 7 may use either depending on privacy mode.
  getOwnJids(): { phoneJid: string | null; lidJid: string | null } {
    const user = this.socket?.user;
    if (!user) return { phoneJid: null, lidJid: null };
    const phone = user.id?.split(':')[0]?.split('@')[0] ?? null;
    const lid = user.lid ? user.lid.split(':')[0]?.split('@')[0] ?? null : null;
    return {
      phoneJid: phone ? `${phone}@s.whatsapp.net` : null,
      lidJid: lid ? `${lid}@lid` : null,
    };
  }

  async createSession(config: SessionConfig): Promise<void> {
    // Guard against duplicate-socket races (e.g. double connection.close events triggering
    // multiple reconnect timers). Closing first ensures we never have two live sockets.
    if (this.socket) {
      try { this.socket.end(undefined); } catch { /* ignore */ }
      this.socket = null;
    }
    this.currentConfig = config;
    const store = new EncryptedFileSessionStore(config.sessionsDir, this.crypto);
    const { state, saveCreds } = await useEncryptedAuthState(store);

    const socket = makeWASocket({ auth: state, printQRInTerminal: false, logger: noopLogger as never });
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    socket.ev.on('messages.upsert', (upsert) => config.onMessage(upsert));

    this.socket = socket;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.socket) throw new Error('No active WhatsApp session');
    await this.socket.sendMessage(to, { text });
  }

  // Downloads + decrypts a media message (audio/image/video). For expired WA-CDN
  // URLs Baileys auto-retries via the bound updateMediaMessage callback.
  async downloadMedia(msg: WAMessage): Promise<Buffer> {
    if (!this.socket) throw new Error('No active WhatsApp session');
    return await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: noopLogger as never,
        reuploadRequest: this.socket.updateMediaMessage.bind(this.socket),
      },
    );
  }

  close(): void {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  private handleConnectionUpdate(update: unknown): void {
    const { connection, lastDisconnect, qr } = update as {
      connection?: string;
      lastDisconnect?: { error?: unknown };
      qr?: string;
    };
    const cfg = this.currentConfig;
    if (!cfg) return;

    if (qr) cfg.onQr(qr);

    if (connection === 'open' && this.socket) {
      // socket.user?.id format: "phoneNumber:deviceId@s.whatsapp.net"
      const phoneNumber = (this.socket.user?.id?.split(':')[0]) ?? '';
      // socket.user?.lid format: "<digits>:deviceId@lid" (or undefined on older sessions)
      const lidRaw = this.socket.user?.lid;
      const lid = lidRaw ? lidRaw.split(':')[0]?.split('@')[0] ?? null : null;
      cfg.onConnected(phoneNumber, lid);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      if (loggedOut) {
        this.close();
        cfg.onDisconnected();
        return;
      }
      // Reconnect on transient errors with a delay to avoid hammering the server
      // during sustained outages — tight reconnect storms risk Baileys session bans.
      // Guard with a single timer reference so double close events don't queue two reconnects.
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.createSession(cfg).catch((err) => {
          console.error('[session-manager] Reconnect failed:', err);
          this.close();
          cfg.onDisconnected();
        });
      }, RECONNECT_DELAY_MS);
    }
  }
}
