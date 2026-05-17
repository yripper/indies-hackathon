import { describe, it, expect } from 'vitest';
import { resolveTools, listAvailableTools } from '../../../src/agent/tools';

describe('resolveTools', () => {
  it('lists all built-in tool names', () => {
    expect(listAvailableTools().sort()).toEqual([
      'analyze_audio_deepfake',
      'analyze_image_deepfake',
      'calculator',
      'detect_deepfake_video',
      'echo',
      'get_current_time',
      'scan_url_deepfake',
      'verificar_noticia',
    ]);
  });

  it('resolves only the requested tools, preserving order', () => {
    const tools = resolveTools(['calculator', 'echo']);
    expect(tools.map((t) => t.name)).toEqual(['calculator', 'echo']);
  });

  it('throws on unknown tool name', () => {
    expect(() => resolveTools(['nonsense'])).toThrow(/Unknown tool/);
  });
});
