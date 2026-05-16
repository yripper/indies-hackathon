import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Database } from '../db/connection';
import type { AgentConfig } from '../config/agent-config';
import { conversationsRepo } from '../db/queries/conversations';
import { messagesRepo, type Message } from '../db/queries/messages';
import { agentRunsRepo } from '../db/queries/agent-runs';
import { toolCallsRepo } from '../db/queries/tool-calls';
import { extractTrace } from '../agent/trace';
import { withConversation } from '../agent/context';
import { peekPendingImage } from './image-cache';
import { imageAnalysesRepo } from '../db/queries/image-analyses';

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
};

export type IncomingMessage = {
  customerPhone: string;
  customerName: string;
  text: string;
};

// MiniMax M2 (and most OpenAI-compatible providers) rejects requests with
// orphaned tool_call_ids or with assistant messages that carry tool_calls
// metadata pointing to tool results that aren't in the current request. The
// tool loop lives inside a single graph.invoke and is never replayed across
// requests, so we strip every 'tool' and 'system' row from Postgres history
// and emit assistants as plain text (no tool_calls metadata reattached).
//
// History entries with role !== 'user'|'assistant' are dropped. The graph
// injects its own static system prompt.
function buildReplayMessages(history: Message[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') out.push(new HumanMessage({ content: m.content }));
    else if (m.role === 'assistant') out.push(new AIMessage({ content: m.content }));
    // 'tool' and 'system' rows: skip.
  }
  return out;
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

// Per-conversation tail queue. WhatsApp delivers messages async, and an image
// upload (which calls dispatchMessage with "(imagen recibida)") can race with
// the user's typed follow-up ("¿podés analizar?"). Without serialization both
// peek the image cache, both invoke the graph, both call the tool, and
// whichever loses the consume-on-read race for takePendingImage replies
// "no image cached" while the winner replies with the real verdict — the
// user gets two messages, one of them confusing.
//
// We chain by JID so different conversations don't block each other.
const conversationQueue = new Map<string, Promise<void>>();

async function serializePerConversation<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = conversationQueue.get(key);
  let resolveMine!: () => void;
  const myDone = new Promise<void>((r) => {
    resolveMine = r;
  });
  conversationQueue.set(key, myDone);

  if (prior) {
    try {
      await prior;
    } catch {
      // Swallow upstream errors — we still want our turn to run.
    }
  }

  try {
    return await fn();
  } finally {
    resolveMine();
    if (conversationQueue.get(key) === myDone) {
      conversationQueue.delete(key);
    }
  }
}

export async function handleIncomingMessage(
  deps: MessageRouterDeps,
  msg: IncomingMessage,
): Promise<void> {
  return serializePerConversation(msg.customerPhone, () =>
    handleIncomingMessageInner(deps, msg),
  );
}

async function handleIncomingMessageInner(
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

  // Peek (does not consume) the image cache. MiniMax M2 rejects requests
  // with more than one role=system message, so instead of injecting a second
  // SystemMessage we pass the ephemeral note through ALS — agentNode appends
  // it to the static system prompt content for THIS invocation only. History
  // and DB stay clean of stale markers.
  const pending = peekPendingImage(msg.customerPhone);
  let ephemeralSystemNote: string | undefined;
  if (pending) {
    const sourceDesc =
      pending.source === 'direct'
        ? 'reenvío directo del usuario'
        : 'respuesta a un mensaje (reply-tag)';
    ephemeralSystemNote = `Contexto interno actualizado para este turno: hay una imagen pendiente de análisis en esta conversación (mime=${pending.mimetype}, ${pending.bytes} bytes), lista para analizar con la herramienta analyze_image_deepfake. Origen: ${sourceDesc}. Aplicá las reglas de tu system prompt para imagen pendiente.`;
  }

  // MiniMax-M2 anchors on the literal user-message text and ignores
  // system-prompt hints when the caption is a question like "¿es esta imagen
  // real?" — it replies "no veo la imagen" even though the image is cached.
  // Appending a per-turn marker to the last HumanMessage gives every provider
  // the concrete in-message signal that v0 carried as "[Imagen adjunta: URL]".
  // DB history stays untouched; only the in-flight replay carries the marker.
  const replayMessages = buildReplayMessages(history);
  if (pending && replayMessages.length > 0) {
    const lastIdx = replayMessages.length - 1;
    const last = replayMessages[lastIdx];
    if (last instanceof HumanMessage && typeof last.content === 'string') {
      const kb = Math.max(1, Math.round(pending.bytes / 1024));
      replayMessages[lastIdx] = new HumanMessage({
        content: `${last.content}\n\n[adjuntó una imagen (${pending.mimetype}, ${kb} KB) lista para analyze_image_deepfake]`,
      });
    }
  }

  const startedAt = Date.now();
  try {
    // ALS carries the JID (for the tool's cache lookup), the ephemeral
    // system note (for agentNode to fold into the system prompt), the
    // progress-sender closure (so the tool can ping "🔍 Analizando..."
    // mid-call), and a recorder that closes over conversation.id + run.id
    // for the DB insert. thread_id stays on the agent run id — there's no
    // checkpointer to track it across requests, but the graph reads it
    // for internal node correlation.
    const rawState = await withConversation(
      {
        conversationId: msg.customerPhone,
        ephemeralSystemNote,
        sendProgress: (text: string) => deps.send(msg.customerPhone, text),
        recordImageAnalysis: async (record) => {
          await imageAnalysesRepo.insert(deps.db, {
            conversationId: conversation.id,
            agentRunId: run.id,
            ...record,
          });
        },
      },
      () =>
        Promise.race([
          deps.graph.invoke(
            { messages: replayMessages },
            { configurable: { thread_id: run.id } },
          ),
          timeoutPromise<unknown>(deps.config.limits.per_message_timeout_ms),
        ]),
    );

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
