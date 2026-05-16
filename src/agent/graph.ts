import { StateGraph, MessagesAnnotation, MemorySaver, END, START } from '@langchain/langgraph';
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
  console.log('[src/agent/graph.ts] buildGraph start', {
    toolCount: input.tools.length,
    toolNames: input.tools.map((t) => t.name),
    maxIterations: input.maxIterations,
    hasBindTools: typeof input.llm.bindTools === 'function',
  });
  // bindTools returns `this` in MockChatModel and a bound runnable in real LLMs.
  // We cast to BaseChatModel so invoke() is available on the result.
  const llmWithTools = input.llm.bindTools
    ? (input.llm.bindTools(input.tools) as unknown as BaseChatModel)
    : input.llm;
  console.log('[src/agent/graph.ts] bindTools complete');

  async function agentNode(state: typeof MessagesAnnotation.State) {
    console.log('[src/agent/graph.ts] agentNode enter', { stateMsgCount: state.messages.length });
    const messages = [new SystemMessage({ content: input.systemPrompt }), ...state.messages];
    console.log('[src/agent/graph.ts] agentNode calling llm.invoke', { totalMsgs: messages.length });
    try {
      const response = await llmWithTools.invoke(messages);
      console.log('[src/agent/graph.ts] agentNode llm.invoke returned', {
        type: response?.constructor?.name,
        contentLen: typeof response?.content === 'string' ? response.content.length : -1,
        toolCalls: 'tool_calls' in (response ?? {}) ? (response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0 : 0,
      });
      return { messages: [response] };
    } catch (err) {
      console.error('[src/agent/graph.ts] agentNode llm.invoke FAILED', err);
      throw err;
    }
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    const isAi = last instanceof AIMessage;
    const hasToolCalls = isAi && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

    // Count AI turns to enforce the iteration cap. Each agent invocation adds
    // one AIMessage, so the count equals the number of completed iterations.
    const iterationCount = state.messages.filter((m) => m instanceof AIMessage).length;
    const decision = iterationCount >= input.maxIterations ? END : hasToolCalls ? 'tools' : END;
    console.log('[src/agent/graph.ts] shouldContinue', { iterationCount, hasToolCalls, decision });
    if (iterationCount >= input.maxIterations) return END;

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

  return graph.compile({ checkpointer: new MemorySaver() });
}
