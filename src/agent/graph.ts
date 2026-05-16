import { StateGraph, MessagesAnnotation, END, START } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getEphemeralSystemNote } from './context';

export type BuildGraphInput = {
  llm: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  maxIterations: number;
};

export function buildGraph(input: BuildGraphInput) {
  // bindTools returns `this` in MockChatModel and a bound runnable in real LLMs.
  // We cast to BaseChatModel so invoke() is available on the result.
  const llmWithTools = input.llm.bindTools
    ? (input.llm.bindTools(input.tools) as unknown as BaseChatModel)
    : input.llm;

  async function agentNode(state: typeof MessagesAnnotation.State) {
    // Per-turn ephemeral note (e.g. "image pending") is appended to the
    // static system prompt content inside the same SystemMessage. MiniMax M2
    // rejects requests with more than one role=system message, so we cannot
    // emit a second SystemMessage even though it would be cleaner.
    const note = getEphemeralSystemNote();
    const systemContent = note ? `${input.systemPrompt}\n\n${note}` : input.systemPrompt;
    const messages = [new SystemMessage({ content: systemContent }), ...state.messages];
    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    const isAi = last instanceof AIMessage;
    const hasToolCalls = isAi && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

    // Iteration cap counts ONLY AIMessages that issued tool calls, not all
    // AIMessages. Historical assistant text replayed from Postgres has no
    // tool_calls and must not consume the cap, otherwise long conversations
    // exhaust it on the first tool turn.
    const toolUseTurns = state.messages.filter(
      (m) => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    ).length;
    if (toolUseTurns >= input.maxIterations) return END;

    return hasToolCalls ? 'tools' : END;
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    // ToolNode constructor expects (StructuredToolInterface | DynamicTool | RunnableToolLike)[].
    // The cast bridges a structural type mismatch upstream without affecting runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addNode('tools', new ToolNode(input.tools as any))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent');

  // No checkpointer: MemorySaver persists tool_calls metadata across invokes,
  // which causes MiniMax to reject the next request with "tool call result
  // does not follow tool call (2013)" because the orphaned tool_call_id has
  // no matching tool message in the new request. Each turn is fully
  // independent; history is rebuilt from Postgres by message-router.
  return graph.compile();
}
