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
import { handleIncomingMessage, handleGroupMessage } from './transport/message-router';
import { isGroupMonitorEnabled } from './transport/group-monitor';
import { healthRoutes } from './api/health';
import { waRoutes } from './api/wa';
import { debugRoutes } from './api/debug';
import { analyticsRoutes } from './api/analytics';
import { publicRoutes } from './api/public';
import { registerShutdownHandlers } from './shutdown';
import { initDedupStore } from './transport/dedup-store';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  initDedupStore(db);

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
    forwardInfo?: import('./transport/forward-detector').ForwardInfo,
  ): Promise<void> {
    await handleIncomingMessage(
      {
        db,
        config: agentConfig,
        graph,
        send: (to, body) => sender.send(to, body),
        sendImage: (to, imageBuffer, caption) => sender.sendImage(to, imageBuffer, caption),
      },
      { customerPhone, customerName, text, forwardInfo },
    );
  }

  // Group auto-monitoring dispatch — only wired when the feature flag is on.
  async function dispatchGroupMessage(
    groupJid: string,
    senderName: string,
    instruction: string,
  ): Promise<void> {
    // The analysisType is embedded in the instruction by shouldAutoAnalyze; we
    // re-derive it here from a simple keyword scan so we can pass it to the router.
    const analysisType = instruction.includes('analyze_audio_deepfake')
      ? 'audio' as const
      : instruction.includes('analyze_image_deepfake')
        ? 'image' as const
        : instruction.includes('detect_deepfake_video')
          ? 'video' as const
          : instruction.includes('scan_url_deepfake')
            ? 'url' as const
            : 'factcheck' as const;

    await handleGroupMessage(
      {
        db,
        config: agentConfig,
        graph,
        send: (to, body) => sender.send(to, body),
        sendImage: (to, imageBuffer, caption) => sender.sendImage(to, imageBuffer, caption),
      },
      { groupJid, senderName, instruction, analysisType },
    );
  }

  const waSession = new WaSession({
    sessionsDir: env.SESSIONS_DIR,
    sessionManager,
    dispatchMessage,
    dispatchGroupMessage: isGroupMonitorEnabled() ? dispatchGroupMessage : undefined,
    log: app.log,
  });

  await app.register(cors, { methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(healthRoutes);
  await app.register(async (instance) => waRoutes(instance, { waSession }));
  await app.register(async (instance) => analyticsRoutes(instance, { db }));
  await app.register(async (instance) => publicRoutes(instance, { db }));

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
