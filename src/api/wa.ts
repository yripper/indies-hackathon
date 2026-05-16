import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WaSession } from '../transport/wa-session';

export type WaRoutesOptions = {
  waSession: WaSession;
};

const ConnectBody = z.object({
  method: z.enum(['qr']).optional().default('qr'),
});

export async function waRoutes(app: FastifyInstance, opts: WaRoutesOptions): Promise<void> {
  app.post('/v1/wa/connect', async (req, reply) => {
    const body = ConnectBody.parse(req.body ?? {});
    void body;
    const status = await opts.waSession.start();
    if (status.connected) return { status: 'connected', phone: status.phone, lid: status.lid };
    if (status.lastQr) return { status: 'qr', qrCode: status.lastQr };
    reply.code(202);
    return { status: 'pending', message: 'Session initializing; poll /v1/wa/status' };
  });

  app.post('/v1/wa/disconnect', async () => {
    opts.waSession.stop();
    return { status: 'disconnected' };
  });

  app.get('/v1/wa/status', async () => {
    const s = opts.waSession.getStatus();
    return { connected: s.connected, phone: s.phone, lid: s.lid, qrCode: s.lastQr };
  });
}
