import { describe, it, expect } from 'vitest';
import { AIMessage, ToolMessage, HumanMessage } from '@langchain/core/messages';
import { extractTrace } from '../../src/agent/trace';

describe('extractTrace', () => {
  it('returns the last AI text and zero tool calls when no tools were used', () => {
    const result = extractTrace({
      messages: [
        new HumanMessage({ content: 'hi' }),
        new AIMessage({ content: 'hello!' }),
      ],
    });
    expect(result.finalText).toBe('hello!');
    expect(result.toolCalls).toEqual([]);
    expect(result.iterations).toBe(1);
  });

  it('pairs tool calls with their tool messages by tool_call_id', () => {
    const result = extractTrace({
      messages: [
        new HumanMessage({ content: 'time?' }),
        new AIMessage({
          content: '',
          tool_calls: [{ name: 'get_current_time', args: {}, id: 'c1', type: 'tool_call' }],
        }),
        new ToolMessage({ content: '2026-05-16T00:00:00Z', tool_call_id: 'c1' }),
        new AIMessage({ content: 'It is 2026-05-16.' }),
      ],
    });
    expect(result.finalText).toBe('It is 2026-05-16.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_current_time');
    expect(result.toolCalls[0].toolCallId).toBe('c1');
    expect(result.toolCalls[0].result).toBe('2026-05-16T00:00:00Z');
    expect(result.toolCalls[0].succeeded).toBe(true);
    expect(result.iterations).toBe(2);
  });

  it('sums usage_metadata across AI messages when present', () => {
    const a = new AIMessage({ content: 'x' });
    a.usage_metadata = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
    const b = new AIMessage({ content: 'y' });
    b.usage_metadata = { input_tokens: 20, output_tokens: 8, total_tokens: 28 };
    const result = extractTrace({ messages: [a, b] });
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(13);
  });

  it('returns finalText="" when no AI message has content', () => {
    const result = extractTrace({
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [{ name: 'echo', args: { text: 'a' }, id: 'c1', type: 'tool_call' }],
        }),
        new ToolMessage({ content: 'a', tool_call_id: 'c1' }),
      ],
    });
    expect(result.finalText).toBe('');
  });
});
