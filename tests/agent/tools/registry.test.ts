import { describe, it, expect, vi } from 'vitest';

// Mock the DB chain to prevent process.exit(1) from missing env vars
vi.mock('../../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost:5432/test',
    OPENAI_API_KEY: 'test-key',
    REALITY_DEFENDER_API_KEY: 'test-key',
    SIGHTENGINE_API_USER: 'test',
    SIGHTENGINE_API_SECRET: 'test',
    DEEPFAKE_SERVICE_URL: 'http://localhost:7860',
    GOOGLE_FACT_CHECK_API_KEY: 'test-key',
  },
}));

vi.mock('../../../src/config/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../../../src/db/connection', () => ({
  db: {},
  pgClient: {},
  createDb: vi.fn(() => ({ db: {}, client: {} })),
}));

vi.mock('../../../src/db/queries/audio-analyses', () => ({
  audioAnalysesRepo: {
    findByConversation: vi.fn().mockResolvedValue([]),
    countByConversation: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../../src/db/queries/image-analyses', () => ({
  imageAnalysesRepo: {
    findByConversation: vi.fn().mockResolvedValue([]),
    countByConversation: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../../src/db/queries/conversations', () => ({
  conversationsRepo: {
    findByPhone: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../src/utils/request-context', () => ({
  getCustomerJid: vi.fn(() => undefined),
  getSendImage: vi.fn(() => undefined),
}));

import { resolveTools, listAvailableTools } from '../../../src/agent/tools';

describe('resolveTools', () => {
  it('lists all built-in tool names', () => {
    expect(listAvailableTools().sort()).toEqual([
      'analyze_audio_deepfake',
      'analyze_image_deepfake',
      'calculator',
      'compare_images',
      'detect_deepfake_video',
      'echo',
      'get_current_time',
      'get_user_stats',
      'scan_url_deepfake',
      'trace_image_source',
      'transcribe_audio',
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
