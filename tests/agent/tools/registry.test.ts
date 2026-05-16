import { describe, it, expect, vi } from 'vitest';

// The tools index transitively imports env.ts which calls process.exit
// when required env vars are missing. Mock it for unit tests.
vi.mock('../../../src/config/env', () => ({
  env: { REALITY_DEFENDER_API_KEY: 'test-key', SIGHTENGINE_API_USER: '', SIGHTENGINE_API_SECRET: '' },
}));

vi.mock('../../../src/config/logger', () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}));

import { resolveTools, listAvailableTools } from '../../../src/agent/tools';

describe('resolveTools', () => {
  it('lists all built-in tool names', () => {
    expect(listAvailableTools().sort()).toEqual(['analyze_audio_deepfake', 'analyze_image_deepfake', 'calculator', 'echo', 'get_current_time']);
  });

  it('resolves only the requested tools, preserving order', () => {
    const tools = resolveTools(['calculator', 'echo']);
    expect(tools.map((t) => t.name)).toEqual(['calculator', 'echo']);
  });

  it('throws on unknown tool name', () => {
    expect(() => resolveTools(['nonsense'])).toThrow(/Unknown tool/);
  });
});
