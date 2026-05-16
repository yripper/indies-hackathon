import makeWASocket, {
  DisconnectReason,
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

export class SessionManager {
  private socket: WASocket | null = null;
  private currentConfig: SessionConfig | null = null;

  constructor(private readonly crypto: SessionCrypto) {}

  hasSession(): boolean {
    return this.socket !== null;
  }

  async createSession(config: SessionConfig): Promise<void> {
    this.currentConfig = config;
    const store = new EncryptedFileSessionStore(config.sessionsDir, this.crypto);
    const { state, saveCreds } = await useEncryptedAuthState(store);

    const socket = makeWASocket({ auth: state, printQRInTerminal: false });
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    socket.ev.on('messages.upsert', (upsert) => config.onMessage(upsert));

    this.socket = socket;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.socket) throw new Error('No active WhatsApp session');
    await this.socket.sendMessage(to, { text });
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
      setTimeout(() => {
        this.createSession(cfg).catch((err) => {
          console.error('[session-manager] Reconnect failed:', err);
          this.close();
          cfg.onDisconnected();
        });
      }, RECONNECT_DELAY_MS);
    }
  }
}
