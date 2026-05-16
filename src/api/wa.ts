import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { SessionManager } from '../transport/baileys/session-manager';
import { connectClient } from '../transport/baileys/connect-client';
import { env } from '../config/env';

type State = {
  connected: boolean;
  phone: string | null;
  lid: string | null;
  lastQr: string | null;
};

export type WaRoutesOptions = {
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  log: FastifyBaseLogger;
};

const ConnectBody = z.object({
  method: z.enum(['qr']).optional().default('qr'),
});

export async function waRoutes(app: FastifyInstance, opts: WaRoutesOptions): Promise<void> {
  const state: State = { connected: false, phone: null, lid: null, lastQr: null };

  app.post('/v1/wa/connect', async (req, reply) => {
    if (state.connected) return { status: 'connected', phone: state.phone, lid: state.lid };

    const body = ConnectBody.parse(req.body ?? {});
    void body;

    await connectClient({
      sessionsDir: env.SESSIONS_DIR,
      sessionManager: opts.sessionManager,
      dispatchMessage: opts.dispatchMessage,
      log: opts.log,
      onQr: (qr) => {
        state.lastQr = qr;
        opts.log.info('QR generated; expose via GET /v1/wa/status until scanned');
      },
      onConnected: (phone, lid) => {
        state.connected = true;
        state.phone = phone;
        state.lid = lid;
        state.lastQr = null;
        opts.log.info({ phone, lid }, 'WhatsApp connected');
      },
      onDisconnected: () => {
        state.connected = false;
        state.phone = null;
        state.lid = null;
        opts.log.info('WhatsApp disconnected');
      },
    });

    // Wait up to 8s for QR (Baileys emits it shortly after socket open)
    const deadline = Date.now() + 8_000;
    while (!state.lastQr && !state.connected && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (state.connected) return { status: 'connected', phone: state.phone, lid: state.lid };
    if (state.lastQr) return { status: 'qr', qrCode: state.lastQr };
    reply.code(202);
    return { status: 'pending', message: 'Session initializing; poll /v1/wa/status' };
  });

  app.post('/v1/wa/disconnect', async () => {
    opts.sessionManager.close();
    state.connected = false;
    state.phone = null;
    state.lid = null;
    state.lastQr = null;
    return { status: 'disconnected' };
  });

  app.get('/v1/wa/status', async () => ({
    connected: state.connected,
    phone: state.phone,
    lid: state.lid,
    qrCode: state.lastQr,
  }));
}
