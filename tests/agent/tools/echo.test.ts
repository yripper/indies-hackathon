import { describe, it, expect } from 'vitest';
import { echoTool } from '../../../src/agent/tools/echo';

describe('echoTool', () => {
  it('returns the input text unchanged', async () => {
    const result = await echoTool.invoke({ text: 'hello world' });
    expect(result).toBe('hello world');
  });

  it('returns the empty string for empty input', async () => {
    const result = await echoTool.invoke({ text: '' });
    expect(result).toBe('');
  });

  it('has the expected name and schema', () => {
    expect(echoTool.name).toBe('echo');
    expect(echoTool.description).toMatch(/echo/i);
  });
});
