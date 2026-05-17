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

export async function handleIncomingMessage(
  deps: MessageRouterDeps,
  msg: IncomingMessage,
): Promise<void> {
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

    const rawState = await Promise.race([
      requestContext.run(
        { customerJid: msg.customerPhone, sendImage: boundSendImage },
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

    await deps.send(msg.customerPhone, replyText);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await agentRunsRepo.fail(deps.db, run.id, errorMessage);
    await deps.send(msg.customerPhone, 'Sorry, I hit an error. Try again.');
  }
}
