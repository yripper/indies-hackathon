import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { SessionManager } from './transport/baileys/session-manager';
import type postgres from 'postgres';

export type ShutdownHandle = {
  app: FastifyInstance;
  sessionManager: SessionManager;
  pgClient: ReturnType<typeof postgres>;
};

export function registerShutdownHandlers(handle: ShutdownHandle, log: FastifyBaseLogger): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutdown initiated');
    try {
      handle.sessionManager.close();
      await handle.app.close();
      await handle.pgClient.end({ timeout: 5 });
      log.info('Clean shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
