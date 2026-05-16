import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import { loadAgentConfig } from './config/agent-config';
import { db, pgClient } from './db/connection';
import { sessionCryptoFromEnv } from './security/session-crypto';
import { SessionManager } from './transport/baileys/session-manager';
import { createSender } from './transport/baileys/sender';
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
  const tools = resolveTools(agentConfig.tools.enabled);
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

  await app.register(cors, { methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(healthRoutes);
  await app.register(async (instance) => waRoutes(instance, {
    sessionManager,
    dispatchMessage,
    log: app.log,
  }));

  if (env.NODE_ENV !== 'production') {
    await app.register(async (instance) => debugRoutes(instance, { db }));
  }

  registerShutdownHandlers({ app, sessionManager, pgClient }, app.log);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, host: env.HOST, agent: agentConfig.agent.name }, 'Server up');
}

main().catch((err) => {
  console.error('Boot error:', err);
  process.exit(1);
});
