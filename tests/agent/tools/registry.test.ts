import { describe, it, expect } from 'vitest';
import { resolveTools, listAvailableTools } from '../../../src/agent/tools';

describe('resolveTools', () => {
  it('lists all built-in tool names', () => {
    expect(listAvailableTools().sort()).toEqual([
      'calculator',
      'echo',
      'extract_image_exif',
      'get_current_time',
    ]);
  });

  it('resolves only the requested tools, preserving order', () => {
    const tools = resolveTools(['calculator', 'echo']);
    expect(tools.map((t) => t.name)).toEqual(['calculator', 'echo']);
  });

  it('passes per-tool config slice when provided', () => {
    // A tool that doesn't use config still resolves fine when given one
    const tools = resolveTools(['echo'], { echo: { ignored: true } });
    expect(tools).toHaveLength(1);
  });

  it('throws on unknown tool name', () => {
    expect(() => resolveTools(['nonsense'])).toThrow(/Unknown tool/);
  });
});
