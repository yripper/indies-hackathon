import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Database } from '../db/connection';
import type { AgentConfig } from '../config/agent-config';
import { conversationsRepo } from '../db/queries/conversations';
import { messagesRepo, type Message } from '../db/queries/messages';
import { agentRunsRepo } from '../db/queries/agent-runs';
import { toolCallsRepo } from '../db/queries/tool-calls';
import { extractTrace } from '../agent/trace';
import { requestContext, type SendImageFn } from '../utils/request-context';
import type { ForwardInfo } from './forward-detector';
import { type AnalysisType, shouldSendGroupAlert } from './group-monitor';

type CompiledGraph = {
  invoke: (
    input: { messages: BaseMessage[] },
    config: { configurable: { thread_id: string } },
  ) => Promise<unknown>;
};

export type MessageRouterDeps = {
  db: Database;
  config: AgentConfig;
  graph: CompiledGraph;
  send: (to: string, text: string) => Promise<void>;
  /** Optional — sends a PNG image to a WhatsApp JID/phone.  Wired when a live
   *  WhatsApp session is available; omitted in tests / non-WA transports. */
  sendImage?: (to: string, imageBuffer: Buffer, caption?: string) => Promise<void>;
};

export type IncomingMessage = {
  customerPhone: string;
  customerName: string;
  text: string;
  /** Forwarding metadata extracted from the raw Baileys WAMessage, if available. */
  forwardInfo?: ForwardInfo;
};

/**
 * Message coming from a group channel via the auto-monitoring path.
 * The `instruction` is the auto-generated prompt fragment that tells the LLM
 * what to do, and `analysisType` drives the quiet-mode filter.
 */
export type GroupIncomingMessage = {
  /** The group JID (e.g. "120363...@g.us") — used as the send destination. */
  groupJid: string;
  senderName: string;
  /** Auto-generated instruction created by shouldAutoAnalyze(). */
  instruction: string;
  analysisType: AnalysisType;
};

function toLangChainMessage(m: Message): BaseMessage {
  if (m.role === 'user') return new HumanMessage({ content: m.content });
  if (m.role === 'assistant') return new AIMessage({ content: m.content });
  if (m.role === 'tool' && m.toolCallId) {
    return new ToolMessage({ content: m.content, tool_call_id: m.toolCallId });
  }
  // 'system' messages from history are not replayed — the graph injects its own system prompt.
  return new AIMessage({ content: m.content });
}

function timeoutPromise<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Agent run exceeded ${ms}ms`)), ms);
  });
}

/**
 * Detects whether the incoming message content looks like a media reference so
 * we can auto-suggest the right analysis tool via the context prefix.
 */
function detectMediaKind(text: string): 'video' | 'audio' | 'image' | 'text' {
  if (/\[VIDEO:/i.test(text)) return 'video';
  if (/\[AUDIO:/i.test(text)) return 'audio';
  if (/\[IMAGE:/i.test(text)) return 'image';
  return 'text';
}

/**
 * Builds the context prefix injected at the top of the user message for the LLM
 * when forwarding is detected. Returns empty string if no forwarding.
 */
function buildForwardingPrefix(
  forwardInfo: ForwardInfo | undefined,
  text: string,
): string {
  if (!forwardInfo || forwardInfo.viralLevel === 'none') return '';

  if (forwardInfo.viralLevel === 'high') {
    const mediaKind = detectMediaKind(text);
    const autoTrigger =
      mediaKind === 'video'
        ? ' Usa detect_deepfake_video para analizarlo.'
        : mediaKind === 'audio'
          ? ' Usa analyze_audio_deepfake para analizarlo.'
          : mediaKind === 'image'
            ? ' Usa analyze_image_deepfake para analizarlo.'
            : ' Usa verificar_noticia para verificarlo.';
    return (
      `[⚠️ ALERTA: Este mensaje ha sido reenviado muchas veces. ` +
      `Contenido potencialmente viral. Analízalo con especial cuidado.${autoTrigger}]\n`
    );
  }

  // viralLevel === 'low'
  return '[ℹ️ Mensaje reenviado]\n';
}

function assertGraphState(value: unknown): asserts value is { messages: BaseMessage[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('messages' in value) ||
    !Array.isArray((value as { messages: unknown }).messages)
  ) {
    throw new Error('Unexpected graph output shape');
  }
}

/**
 * Handle an auto-monitored group message.
 *
 * The flow mirrors handleIncomingMessage but:
 *   1. Uses the group JID as the "customerPhone" for conversation threading.
 *   2. Applies quiet mode — only sends a reply when the analysis verdict is
 *      suspicious (FAKE / UNCERTAIN) or when it's a fact-check result.
 *   3. Sends the reply back to the group JID, not to an individual phone.
 */
export async function handleGroupMessage(
  deps: MessageRouterDeps,
  msg: GroupIncomingMessage,
): Promise<void> {
  // Use the group JID as the conversation thread key so message history is
  // shared across all auto-analyses in that group.
  const conversation = await conversationsRepo.findOrCreate(deps.db, {
    customerPhone: msg.groupJid,
    customerName: `group:${msg.groupJid}`,
  });
  if (conversation.status !== 'active') return;

  const userMsg = await messagesRepo.create(deps.db, {
    conversationId: conversation.id,
    role: 'user',
    content: msg.instruction,
  });

  const history = await messagesRepo.listRecent(
    deps.db,
    conversation.id,
    deps.config.limits.history_window,
  );

  const run = await agentRunsRepo.start(deps.db, {
    conversationId: conversation.id,
    triggerMessageId: userMsg.id,
    agentName: deps.config.agent.name,
    provider: deps.config.provider.name,
    model: deps.config.provider.model,
  });

  const startedAt = Date.now();
  try {
    const boundSendImage: SendImageFn | undefined = deps.sendImage
      ? (buf, caption) => deps.sendImage!(msg.groupJid, buf, caption)
      : undefined;

    const rawState = await Promise.race([
      requestContext.run(
        { customerJid: msg.groupJid, sendImage: boundSendImage },
        () =>
          deps.graph.invoke(
            { messages: history.map(toLangChainMessage) },
            { configurable: { thread_id: conversation.id } },
          ),
      ),
      timeoutPromise<unknown>(deps.config.limits.per_message_timeout_ms),
    ]);

    assertGraphState(rawState);
    const trace = extractTrace(rawState);
    const latencyMs = Date.now() - startedAt;

    const replyText =
      trace.finalText.length > 0 ? trace.finalText : "I wasn't able to generate a reply.";

    await messagesRepo.create(deps.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: replyText,
    });

    const capped = trace.iterations >= deps.config.limits.max_tool_iterations;
    await agentRunsRepo.finish(deps.db, run.id, {
      status: capped ? 'capped' : 'completed',
      iterations: trace.iterations,
      inputTokens: trace.inputTokens ?? null,
      outputTokens: trace.outputTokens ?? null,
      latencyMs,
    });

    if (trace.toolCalls.length > 0) {
      await toolCallsRepo.createMany(
        deps.db,
        trace.toolCalls.map((tc) => ({
          agentRunId: run.id,
          toolName: tc.name,
          toolCallId: tc.toolCallId,
          arguments: tc.args,
          result: tc.result,
          error: tc.error,
          latencyMs: tc.latencyMs ?? undefined,
          succeeded: tc.succeeded,
        })),
      );
    }

    // Quiet mode: only alert the group when the result is suspicious.
    if (shouldSendGroupAlert(replyText, msg.analysisType)) {
      await deps.send(msg.groupJid, replyText);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await agentRunsRepo.fail(deps.db, run.id, errorMessage);
    // Do not spam the group on errors — silently log and move on.
    console.error(`[group-monitor] error in group ${msg.groupJid}: ${errorMessage}`);
  }
}

export async function handleIncomingMessage(
  deps: MessageRouterDeps,
  msg: IncomingMessage,
): Promise<void> {
  // ── Forwarding detection ────────────────────────────────────────────────────
  const forwardInfo = msg.forwardInfo;
  if (forwardInfo && forwardInfo.isForwarded) {
    console.log(
      `[forward-detector] phone=${msg.customerPhone} ` +
        `isForwarded=${forwardInfo.isForwarded} ` +
        `score=${forwardInfo.forwardingScore} ` +
        `viralLevel=${forwardInfo.viralLevel}`,
    );
  }

  const forwardingPrefix = buildForwardingPrefix(forwardInfo, msg.text);
  // The text stored in the DB is the raw user text (no prefix) so history stays
  // clean; the LLM receives the enriched version with the forwarding context.
  const llmText = forwardingPrefix ? `${forwardingPrefix}${msg.text}` : msg.text;
  // ────────────────────────────────────────────────────────────────────────────

  const conversation = await conversationsRepo.findOrCreate(deps.db, {
    customerPhone: msg.customerPhone,
    customerName: msg.customerName,
  });
  if (conversation.status !== 'active') return;

  const userMsg = await messagesRepo.create(deps.db, {
    conversationId: conversation.id,
    role: 'user',
    content: msg.text,
  });

  const history = await messagesRepo.listRecent(
    deps.db,
    conversation.id,
    deps.config.limits.history_window,
  );

  const run = await agentRunsRepo.start(deps.db, {
    conversationId: conversation.id,
    triggerMessageId: userMsg.id,
    agentName: deps.config.agent.name,
    provider: deps.config.provider.name,
    model: deps.config.provider.model,
  });

  const startedAt = Date.now();
  try {
    // Build a per-request sendImage closure bound to the current phone so that
    // tools can send images without knowing the recipient at tool-creation time.
    // AsyncLocalStorage propagates this through the entire async call tree,
    // making it safely available to tool implementations via getSendImage().
    const boundSendImage: SendImageFn | undefined = deps.sendImage
      ? (buf, caption) => deps.sendImage!(msg.customerPhone, buf, caption)
      : undefined;

    // If a forwarding prefix was generated, replace the last history message
    // (which is the current user message stored with the raw text) with the
    // enriched version so the LLM sees the forwarding context.
    const langChainHistory = history.map((m, i) => {
      if (forwardingPrefix && i === history.length - 1 && m.role === 'user') {
        return new HumanMessage({ content: llmText });
      }
      return toLangChainMessage(m);
    });

    const rawState = await Promise.race([
      requestContext.run(
        { customerJid: msg.customerPhone, sendImage: boundSendImage },
        () =>
          deps.graph.invoke(
            { messages: langChainHistory },
            { configurable: { thread_id: conversation.id } },
          ),
      ),
      timeoutPromise<unknown>(deps.config.limits.per_message_timeout_ms),
    ]);

    assertGraphState(rawState);
    const trace = extractTrace(rawState);
    const latencyMs = Date.now() - startedAt;

    const replyText =
      trace.finalText.length > 0 ? trace.finalText : "I wasn't able to generate a reply.";

    await messagesRepo.create(deps.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: replyText,
    });

    const capped = trace.iterations >= deps.config.limits.max_tool_iterations;
    await agentRunsRepo.finish(deps.db, run.id, {
      status: capped ? 'capped' : 'completed',
      iterations: trace.iterations,
      inputTokens: trace.inputTokens ?? null,
      outputTokens: trace.outputTokens ?? null,
      latencyMs,
    });

    if (trace.toolCalls.length > 0) {
      await toolCallsRepo.createMany(
        deps.db,
        trace.toolCalls.map((tc) => ({
          agentRunId: run.id,
          toolName: tc.name,
          toolCallId: tc.toolCallId,
          arguments: tc.args,
          result: tc.result,
          error: tc.error,
          latencyMs: tc.latencyMs ?? undefined,
          succeeded: tc.succeeded,
        })),
      );
    }

    await deps.send(msg.customerPhone, replyText);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await agentRunsRepo.fail(deps.db, run.id, errorMessage);
    await deps.send(msg.customerPhone, 'Sorry, I hit an error. Try again.');
  }
}
