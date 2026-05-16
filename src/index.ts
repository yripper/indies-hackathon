import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import { loadAgentConfig } from './config/agent-config';
import { db, pgClient } from './db/connection';
import { sessionCryptoFromEnv } from './security/session-crypto';
import { SessionManager } from './transport/baileys/session-manager';
import { createSender } from './transport/baileys/sender';
import { WaSession } from './transport/wa-session';
import { buildLlm } from './agent/llm';
import { buildGraph } from './agent/graph';
import { resolveTools } from './agent/tools';
import { handleIncomingMessage } from './transport/message-router';
import { healthRoutes } from './api/health';
import { waRoutes } from './api/wa';
import { debugRoutes } from './api/debug';
import { registerShutdownHandlers } from './shutdown';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  const agentConfig = loadAgentConfig(env.AGENT_CONFIG_PATH);
  const llm = buildLlm(agentConfig.provider);
  const tools = resolveTools(agentConfig.tools.enabled, agentConfig.tools.config);
  const graph = buildGraph({
    llm,
    tools,
    systemPrompt: agentConfig.agent.system_prompt,
    maxIterations: agentConfig.limits.max_tool_iterations,
  });

  const sessionManager = new SessionManager(sessionCryptoFromEnv(env.WA_SESSION_KEY));
  const sender = createSender(sessionManager);

  async function dispatchMessage(
    customerPhone: string,
    customerName: string,
    text: string,
  ): Promise<void> {
    await handleIncomingMessage(
      {
        db,
        config: agentConfig,
        graph,
        send: (to, body) => sender.send(to, body),
      },
      { customerPhone, customerName, text },
    );
  }

  const waSession = new WaSession({
    sessionsDir: env.SESSIONS_DIR,
    sessionManager,
    dispatchMessage,
    log: app.log,
  });

  await app.register(cors, { methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(healthRoutes);
  await app.register(async (instance) => waRoutes(instance, { waSession }));

  if (env.NODE_ENV !== 'production') {
    await app.register(async (instance) => debugRoutes(instance, { db }));
  }

  registerShutdownHandlers({ app, sessionManager, pgClient }, app.log);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, host: env.HOST, agent: agentConfig.agent.name }, 'Server up');

  if (waSession.hasPairedCreds()) {
    app.log.info('Existing session creds found; auto-restoring WhatsApp connection');
    waSession.start().then((status) => {
      app.log.info({ connected: status.connected, phone: status.phone }, 'Auto-restore result');
    }).catch((err) => {
      app.log.error({ err }, 'Auto-restore failed');
    });
  } else {
    app.log.info('No session creds on disk; POST /v1/wa/connect to pair');
  }
}

main().catch((err) => {
  console.error('Boot error:', err);
  process.exit(1);
});
