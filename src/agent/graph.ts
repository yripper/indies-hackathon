import { StateGraph, MessagesAnnotation, END, START } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';

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
    const messages = [new SystemMessage({ content: input.systemPrompt }), ...state.messages];
    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    const isAi = last instanceof AIMessage;
    const hasToolCalls = isAi && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

    // Cap counts only AIMessages that actually have tool_calls — i.e. active
    // tool-use roundtrips inside this single graph.invoke. Historical
    // assistant text replayed from Postgres has no tool_calls (the replay
    // path in message-router strips them), so it doesn't consume the cap.
    // Counting "all AIMessages" would let a long conversation history
    // exhaust the cap on iteration 1 and END before any tool runs.
    const toolUseTurns = state.messages.filter(
      (m) => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    ).length;
    if (toolUseTurns >= input.maxIterations) return END;

    return hasToolCalls ? 'tools' : END;
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    // ToolNode constructor expects (StructuredToolInterface | DynamicTool | RunnableToolLike)[].
    // echoTool is cast to a wider EchoTool type upstream; the `any` cast here is intentional
    // to bridge the mismatch without affecting runtime behaviour.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addNode('tools', new ToolNode(input.tools as any))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent');

  // Intentionally no checkpointer. The message-router rebuilds the history
  // from Postgres on every invocation, so persisting graph state would only
  // cause two failure modes:
  //   1. The iteration cap counts AIMessages across ALL prior turns and
  //      stops the new turn's tool loop before any tool runs.
  //   2. A turn that ends with an unresolved tool_call (e.g. cap hit before
  //      ToolNode executes) pollutes the next turn — providers like MiniMax
  //      reject the request with "tool call result does not follow tool call".
  return graph.compile();
}
