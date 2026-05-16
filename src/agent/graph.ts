import { StateGraph, MessagesAnnotation, MemorySaver, END, START } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getEphemeralSystemNote } from './context';

// Count AIMessages added in the current turn (i.e. after the last HumanMessage,
// which represents the just-received user input). The old version counted ALL
// AIMessages in state.messages, so any conversation with >maxIterations history
// would be capped immediately on the first agent call. That bug killed tool
// dispatch entirely once history grew past 5 messages.
function iterationsThisTurn(messages: BaseMessage[]): number {
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) {
      lastHumanIdx = i;
      break;
    }
  }
  return messages.slice(lastHumanIdx + 1).filter((m) => m instanceof AIMessage).length;
}

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
    // Some providers (MiniMax M2) reject a request that contains more than
    // one role=system message. Fold any per-turn ephemeral note into the
    // single SystemMessage content here, rather than prepending a second
    // SystemMessage at the router layer.
    const ephemeral = getEphemeralSystemNote();
    const systemContent = ephemeral
      ? `${input.systemPrompt}\n\n[Contexto interno actualizado para este turno]\n${ephemeral}`
      : input.systemPrompt;
    const messages = [new SystemMessage({ content: systemContent }), ...state.messages];
    const iterationBefore = iterationsThisTurn(state.messages);
    console.log(
      `[agent] → LLM call (turn-iter ${iterationBefore + 1}/${input.maxIterations}): ${messages.length} messages in${ephemeral ? ' (with ephemeral context)' : ''}`,
    );
    const t0 = Date.now();
    const response = await llmWithTools.invoke(messages);
    const dt = Date.now() - t0;
    const aiResp = response as AIMessage;
    const toolCallsCount = Array.isArray(aiResp.tool_calls) ? aiResp.tool_calls.length : 0;
    const contentPreview =
      typeof aiResp.content === 'string'
        ? aiResp.content.slice(0, 200).replace(/\n/g, ' ')
        : '[non-string content]';
    console.log(
      `[agent] ← LLM returned in ${dt}ms: tool_calls=${toolCallsCount}, content="${contentPreview}"`,
    );
    if (toolCallsCount > 0 && Array.isArray(aiResp.tool_calls)) {
      for (const call of aiResp.tool_calls) {
        console.log(
          `[agent]   tool_call: ${call.name}(${JSON.stringify(call.args ?? {})})`,
        );
      }
    }
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    const isAi = last instanceof AIMessage;
    const hasToolCalls = isAi && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

    const iter = iterationsThisTurn(state.messages);
    if (iter >= input.maxIterations) {
      console.log(
        `[agent] shouldContinue → END (max iter ${input.maxIterations} reached this turn)`,
      );
      return END;
    }

    const decision = hasToolCalls ? 'tools' : END;
    console.log(
      `[agent] shouldContinue → ${decision === END ? 'END' : 'tools'} (turn-iter=${iter}, hasToolCalls=${hasToolCalls})`,
    );
    return decision;
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
