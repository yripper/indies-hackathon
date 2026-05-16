import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { buildGraph } from '../../src/agent/graph';
import { echoTool } from '../../src/agent/tools/echo';
import { MockChatModel } from '../helpers/mock-llm';
import { extractTrace } from '../../src/agent/trace';

describe('buildGraph', () => {
  it('returns final text directly when LLM emits no tool calls', async () => {
    const llm = new MockChatModel([{ type: 'text', content: 'hi there' }]);
    const graph = buildGraph({
      llm,
      tools: [echoTool],
      systemPrompt: 'You are X.',
      maxIterations: 5,
    });
    const result = await graph.invoke(
      { messages: [new HumanMessage({ content: 'hello' })] },
      { configurable: { thread_id: 'test-1' } },
    );
    const trace = extractTrace(result);
    expect(trace.finalText).toBe('hi there');
    expect(trace.toolCalls).toEqual([]);
  });

  it('loops: LLM requests echo tool, then returns final text after seeing result', async () => {
    const llm = new MockChatModel([
      { type: 'tool_call', toolName: 'echo', args: { text: 'ping' }, toolCallId: 'c1' },
      { type: 'text', content: 'echoed ping' },
    ]);
    const graph = buildGraph({
      llm,
      tools: [echoTool],
      systemPrompt: 'You are X.',
      maxIterations: 5,
    });
    const result = await graph.invoke(
      { messages: [new HumanMessage({ content: 'echo ping' })] },
      { configurable: { thread_id: 'test-2' } },
    );
    const trace = extractTrace(result);
    expect(trace.finalText).toBe('echoed ping');
    expect(trace.toolCalls).toHaveLength(1);
    expect(trace.toolCalls[0].name).toBe('echo');
    expect(trace.toolCalls[0].result).toBe('ping');
    expect(trace.toolCalls[0].succeeded).toBe(true);
  });

  it('respects maxIterations when LLM keeps asking for tools', async () => {
    const llm = new MockChatModel([
      { type: 'tool_call', toolName: 'echo', args: { text: '1' }, toolCallId: 'c1' },
      { type: 'tool_call', toolName: 'echo', args: { text: '2' }, toolCallId: 'c2' },
      { type: 'tool_call', toolName: 'echo', args: { text: '3' }, toolCallId: 'c3' },
    ]);
    const graph = buildGraph({
      llm,
      tools: [echoTool],
      systemPrompt: 'You are X.',
      maxIterations: 2,
    });
    const result = await graph.invoke(
      { messages: [new HumanMessage({ content: 'loop' })] },
      { configurable: { thread_id: 'test-3' } },
    );
    const trace = extractTrace(result);
    expect(trace.iterations).toBeLessThanOrEqual(2);
  });
});
