import { describe, it, expect } from 'vitest';
import { resolveTools, listAvailableTools } from '../../../src/agent/tools';

describe('resolveTools', () => {
  it('lists the core built-in tool names', () => {
    // Use arrayContaining so adding new tools doesn't churn this test.
    expect(listAvailableTools()).toEqual(
      expect.arrayContaining([
        'calculator',
        'echo',
        'extract_image_exif',
        'get_current_time',
        'verify_c2pa_credentials',
      ]),
    );
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
