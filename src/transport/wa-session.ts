import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { SessionManager } from './baileys/session-manager';
import { connectClient } from './baileys/connect-client';

type State = {
  connected: boolean;
  phone: string | null;
  lid: string | null;
  lastQr: string | null;
};

export type WaSessionDeps = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  log: FastifyBaseLogger;
};

export class WaSession {
  private state: State = { connected: false, phone: null, lid: null, lastQr: null };
  private starting = false;
  private started = false;

  constructor(private readonly deps: WaSessionDeps) {}

  getStatus(): State {
    return { ...this.state };
  }

  hasPairedCreds(): boolean {
    return existsSync(path.join(this.deps.sessionsDir, 'creds.json'));
  }

  async start(waitMs = 10_000): Promise<State> {
    if (this.state.connected) return this.getStatus();
    if (this.starting) {
      // Wait for in-flight start
      const deadline = Date.now() + waitMs;
      while (this.starting && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return this.getStatus();
    }
    this.starting = true;
    try {
      if (!this.started) {
        await connectClient({
          sessionsDir: this.deps.sessionsDir,
          sessionManager: this.deps.sessionManager,
          dispatchMessage: this.deps.dispatchMessage,
          log: this.deps.log,
          onQr: (qr) => {
            this.state.lastQr = qr;
            this.deps.log.info('QR generated; expose via GET /v1/wa/status until scanned');
          },
          onConnected: (phone, lid) => {
            this.state.connected = true;
            this.state.phone = phone;
            this.state.lid = lid;
            this.state.lastQr = null;
            this.deps.log.info({ phone, lid }, 'WhatsApp connected');
          },
          onDisconnected: () => {
            this.state.connected = false;
            this.state.phone = null;
            this.state.lid = null;
            this.deps.log.info('WhatsApp disconnected');
          },
        });
        this.started = true;
      }
      const deadline = Date.now() + waitMs;
      while (!this.state.lastQr && !this.state.connected && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return this.getStatus();
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    this.deps.sessionManager.close();
    this.state = { connected: false, phone: null, lid: null, lastQr: null };
    this.started = false;
  }
}
