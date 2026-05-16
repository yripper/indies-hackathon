import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

export type ToolCallTrace = {
  name: string;
  toolCallId: string;
  args: unknown;
  result: unknown;
  latencyMs: number | null;
  succeeded: boolean;
  error?: string;
};

export type TraceResult = {
  finalText: string;
  toolCalls: ToolCallTrace[];
  iterations: number;
  inputTokens?: number;
  outputTokens?: number;
};

export function extractTrace(state: { messages: BaseMessage[] }): TraceResult {
  const toolCallsByCallId = new Map<string, ToolCallTrace>();
  let inputTokens = 0;
  let outputTokens = 0;
  let usageSeen = false;
  let lastTextFromAI = '';

  // iterations should reflect the current turn only — count AI messages after
  // the last HumanMessage. Anything before that is historical replay.
  let lastHumanIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i] instanceof HumanMessage) {
      lastHumanIdx = i;
      break;
    }
  }
  let iterations = 0;

  for (let i = 0; i < state.messages.length; i++) {
    const msg = state.messages[i];
    const isThisTurn = i > lastHumanIdx;
    if (msg instanceof AIMessage) {
      if (isThisTurn) iterations += 1;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.length > 0) lastTextFromAI = content;

      const meta = (msg as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
        .usage_metadata;
      if (meta) {
        usageSeen = true;
        inputTokens += meta.input_tokens ?? 0;
        outputTokens += meta.output_tokens ?? 0;
      }

      for (const call of msg.tool_calls ?? []) {
        toolCallsByCallId.set(call.id ?? '', {
          name: call.name,
          toolCallId: call.id ?? '',
          args: call.args,
          result: null,
          latencyMs: null,
          succeeded: false,
        });
      }
    } else if (msg instanceof ToolMessage) {
      const entry = toolCallsByCallId.get(msg.tool_call_id);
      if (entry) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const looksLikeError = /^Error:/i.test(text);
        entry.result = text;
        entry.succeeded = !looksLikeError;
        if (looksLikeError) entry.error = text;
      }
    }
  }

  return {
    finalText: stripReasoningTags(lastTextFromAI),
    toolCalls: Array.from(toolCallsByCallId.values()),
    iterations,
    inputTokens: usageSeen ? inputTokens : undefined,
    outputTokens: usageSeen ? outputTokens : undefined,
  };
}

// Reasoning models (MiniMax M2, DeepSeek-R1, etc.) wrap chain-of-thought in
// <think>...</think> tags inside `content`. Strip them so the user-facing
// reply isn't polluted by internal reasoning.
function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}
