import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/connection';
import type { AgentConfig } from '../config/agent-config';
import { conversationsRepo } from '../db/queries/conversations';
import { messagesRepo, type Message } from '../db/queries/messages';
import { agentRunsRepo } from '../db/queries/agent-runs';
import { toolCallsRepo } from '../db/queries/tool-calls';
import { extractTrace } from '../agent/trace';

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
  log?: FastifyBaseLogger;
};

export type IncomingMessage = {
  customerPhone: string;
  customerName: string;
  text: string;
};

/**
 * Build the LangChain message list we send back to the LLM on each turn.
 *
 * Important MiniMax / OpenAI-compat constraint: providers like MiniMax-M2
 * (error 2013, "tool call result does not follow tool call") reject any
 * request whose history contains an assistant message with `tool_calls`
 * that is not IMMEDIATELY followed by its `ToolMessage` results. They are
 * effectively stateless — every request must be a self-contained
 * conversation.
 *
 * Our DB stores `role: tool` rows in the same `messages` table as the
 * audit/debug record of what happened, but we deliberately drop them when
 * replaying history. The tool loop lives entirely within a single
 * `graph.invoke` — the LLM sees AIMessage(tool_calls) + ToolMessage(...)
 * sequences only inside one HTTP request, never across requests.
 * Persisted `assistant` rows hold final text only (no `tool_calls` field),
 * so they replay cleanly.
 */
function buildReplayMessages(history: Message[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of history) {
    if (m.role === 'tool') continue; // never replay tool results across turns
    if (m.role === 'system') continue; // graph injects its own system prompt
    if (m.role === 'user') {
      out.push(new HumanMessage({ content: m.content }));
    } else if (m.role === 'assistant') {
      // Reconstruct as plain text — no tool_calls metadata is reattached.
      out.push(new AIMessage({ content: m.content }));
    }
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
  deps.log?.info(
    {
      conversationId: conversation.id,
      runId: run.id,
      customerPhone: msg.customerPhone,
      historyDepth: history.length,
      userTextPreview: msg.text.slice(0, 200),
      userTextLength: msg.text.length,
    },
    'agent: invoking graph',
  );

  try {
    const replayMessages = buildReplayMessages(history);
    const rawState = await Promise.race([
      deps.graph.invoke(
        { messages: replayMessages },
        // A unique thread_id per invocation defends against any future
        // checkpointer addition: even if someone re-enables a checkpointer,
        // each turn would still start with a clean state instead of
        // accumulating tool_calls that would later trip MiniMax 400 (2013).
        { configurable: { thread_id: run.id } },
      ),
      timeoutPromise<unknown>(deps.config.limits.per_message_timeout_ms),
    ]);

    assertGraphState(rawState);
    const trace = extractTrace(rawState);
    const latencyMs = Date.now() - startedAt;

    const replyText =
      trace.finalText.length > 0 ? trace.finalText : "I wasn't able to generate a reply.";

    deps.log?.info(
      {
        conversationId: conversation.id,
        runId: run.id,
        iterations: trace.iterations,
        toolCallCount: trace.toolCalls.length,
        toolNames: trace.toolCalls.map((tc) => tc.name),
        toolFailures: trace.toolCalls.filter((tc) => !tc.succeeded).map((tc) => ({
          name: tc.name,
          error: tc.error,
        })),
        replyPreview: replyText.slice(0, 200),
        replyLength: replyText.length,
        latencyMs,
        inputTokens: trace.inputTokens ?? null,
        outputTokens: trace.outputTokens ?? null,
      },
      'agent: graph completed',
    );

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
    deps.log?.error(
      {
        conversationId: conversation.id,
        runId: run.id,
        err,
        errorMessage,
        latencyMs: Date.now() - startedAt,
      },
      'agent: graph FAILED',
    );
    await agentRunsRepo.fail(deps.db, run.id, errorMessage);
    await deps.send(msg.customerPhone, 'Sorry, I hit an error. Try again.');
  }
}
