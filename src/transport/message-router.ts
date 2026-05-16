import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Database } from '../db/connection';
import type { AgentConfig } from '../config/agent-config';
import { conversationsRepo } from '../db/queries/conversations';
import { messagesRepo, type Message } from '../db/queries/messages';
import { agentRunsRepo } from '../db/queries/agent-runs';
import { toolCallsRepo } from '../db/queries/tool-calls';
import { extractTrace } from '../agent/trace';
import { withConversation } from '../agent/context';
import { peekPendingAudio } from './audio-cache';
import { peekPendingImage } from './image-cache';
import { audioAnalysesRepo } from '../db/queries/audio-analyses';
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

// Per-conversation tail queue. WhatsApp delivers messages async, and audio
// uploads (which call dispatchMessage with "(audio reenviado)") can race with
// the user's typed follow-up ("¿podés analizar?"). Without serialization both
// peek the audio cache, both invoke the graph, both call the tool, and
// whichever loses the consume-on-read race for takePendingAudio replies
// "no audio cached" while the winner replies with the real verdict — the
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
    console.log(`[router] queued behind in-flight message for jid=${key}`);
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
  const textPreview = msg.text.slice(0, 200).replace(/\n/g, ' ');
  console.log(
    `[router] ▶ incoming: from=${msg.customerPhone} name="${msg.customerName}" text="${textPreview}"`,
  );

  const conversation = await conversationsRepo.findOrCreate(deps.db, {
    customerPhone: msg.customerPhone,
    customerName: msg.customerName,
  });
  if (conversation.status !== 'active') {
    console.log(`[router] conversation ${conversation.id} status=${conversation.status} → drop`);
    return;
  }

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

  console.log(
    `[router] convId=${conversation.id} history=${history.length}msgs → invoking graph`,
  );

  const run = await agentRunsRepo.start(deps.db, {
    conversationId: conversation.id,
    triggerMessageId: userMsg.id,
    agentName: deps.config.agent.name,
    provider: deps.config.provider.name,
    model: deps.config.provider.model,
  });

  // Peek pending audio and image (neither consumes). MiniMax M2 rejects
  // requests with more than one role=system message, so we fold both hints
  // into a single ephemeral note appended to the static system prompt for
  // THIS turn only via ALS. History and DB stay clean of stale markers.
  const pendingAudio = peekPendingAudio(msg.customerPhone);
  const pendingImage = peekPendingImage(msg.customerPhone);
  const notes: string[] = [];
  if (pendingAudio) {
    const src =
      pendingAudio.source === 'direct'
        ? 'reenvío directo del usuario'
        : 'respuesta a un mensaje (reply-tag) del grupo';
    notes.push(
      `Contexto interno actualizado para este turno: hay un audio pendiente de ${pendingAudio.durationSec} segundos en esta conversación, listo para analizar con la herramienta analyze_audio_deepfake. Origen: ${src}. Aplicá las reglas de tu system prompt para audio pendiente.`,
    );
    console.log(
      `[router] pending audio detected (dur=${pendingAudio.durationSec}s source=${pendingAudio.source})`,
    );
  }
  if (pendingImage) {
    const src =
      pendingImage.source === 'direct'
        ? 'reenvío directo del usuario'
        : 'respuesta a un mensaje (reply-tag) del grupo';
    notes.push(
      `Contexto interno actualizado para este turno: hay una imagen pendiente de análisis en esta conversación (mime=${pendingImage.mimetype}, ${pendingImage.bytes} bytes), lista para analizar con la herramienta analyze_image_deepfake. Origen: ${src}. Aplicá las reglas de tu system prompt para imagen pendiente.`,
    );
    console.log(
      `[router] pending image detected (mime=${pendingImage.mimetype} bytes=${pendingImage.bytes} source=${pendingImage.source})`,
    );
  }
  if (notes.length === 0) {
    console.log('[router] no pending media for this conversation');
  }
  const ephemeralSystemNote = notes.length > 0 ? notes.join('\n\n') : undefined;

  // Build the replay once. MiniMax-M2 (and other providers under load) anchor
  // on the literal user-message text and dismiss system-prompt hints when the
  // caption is a question like "¿es esta imagen real?" — they reply "no veo
  // la imagen" even though the bytes are cached. Appending a per-turn marker
  // to the last HumanMessage gives every provider the concrete in-message
  // signal that the original prototype carried as "[Imagen adjunta: URL]".
  // DB history stays untouched; only the in-flight replay carries the marker.
  const replayMessages = history.map(toLangChainMessage);
  if ((pendingAudio || pendingImage) && replayMessages.length > 0) {
    const lastIdx = replayMessages.length - 1;
    const last = replayMessages[lastIdx];
    if (last instanceof HumanMessage && typeof last.content === 'string') {
      const markers: string[] = [];
      if (pendingImage) {
        const kb = Math.max(1, Math.round(pendingImage.bytes / 1024));
        markers.push(
          `[adjuntó una imagen (${pendingImage.mimetype}, ${kb} KB) lista para analyze_image_deepfake]`,
        );
      }
      if (pendingAudio) {
        markers.push(
          `[adjuntó un audio (${pendingAudio.durationSec}s, ${pendingAudio.mimetype}) listo para analyze_audio_deepfake]`,
        );
      }
      replayMessages[lastIdx] = new HumanMessage({
        content: `${last.content}\n\n${markers.join('\n')}`,
      });
    }
  }

  const startedAt = Date.now();
  try {
    // ALS carries the JID (for tool cache lookups) plus the ephemeral system
    // note (for agentNode to fold into the system prompt) and the per-media
    // DB recorder closures. Errors in the DB inserts are swallowed at the
    // call site — a failed dashboard write must not break the user-facing
    // reply.
    const rawState = await withConversation(
      {
        conversationId: msg.customerPhone,
        ephemeralSystemNote,
        sendProgress: (text: string) => deps.send(msg.customerPhone, text),
        recordAudioAnalysis: async (record) => {
          await audioAnalysesRepo.insert(deps.db, {
            conversationId: conversation.id,
            agentRunId: run.id,
            ...record,
          });
        },
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
            { configurable: { thread_id: conversation.id } },
          ),
          timeoutPromise<unknown>(deps.config.limits.per_message_timeout_ms),
        ]),
    );

    assertGraphState(rawState);
    const trace = extractTrace(rawState);
    const latencyMs = Date.now() - startedAt;

    console.log(
      `[router] graph done: iterations=${trace.iterations}, toolCalls=${trace.toolCalls.length}, finalTextChars=${trace.finalText.length}, latency=${latencyMs}ms`,
    );
    for (const tc of trace.toolCalls) {
      console.log(
        `[router]   tool=${tc.name} succeeded=${tc.succeeded} resultPreview="${String(tc.result ?? '').slice(0, 120).replace(/\n/g, ' ')}"`,
      );
    }

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

    console.log(
      `[router] ◀ replying: chars=${replyText.length} preview="${replyText.slice(0, 200).replace(/\n/g, ' ')}"`,
    );
    await deps.send(msg.customerPhone, replyText);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[router] ✗ agent run failed: ${errorMessage}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    await agentRunsRepo.fail(deps.db, run.id, errorMessage);
    await deps.send(msg.customerPhone, 'Sorry, I hit an error. Try again.');
  }
}
