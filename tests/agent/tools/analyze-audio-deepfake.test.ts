import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules BEFORE imports (vitest hoists these)
vi.mock('../../../src/config/env', () => ({
  env: { REALITY_DEFENDER_API_KEY: 'test-key' },
}));

vi.mock('../../../src/config/logger', () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}));

vi.mock('../../../src/integrations/reality-defender', () => ({
  analyzeAudio: vi.fn(),
  QuotaExhaustedError: class QuotaExhaustedError extends Error {
    constructor() {
      super('quota');
      this.name = 'QuotaExhaustedError';
    }
  },
}));

vi.mock('../../../src/transport/audio-cache', () => ({
  takePendingAudio: vi.fn(),
}));

vi.mock('../../../src/agent/context', () => ({
  getCurrentConversationId: vi.fn(() => 'test-jid@s.whatsapp.net'),
  getProgressSender: vi.fn(() => null),
  getAudioAnalysisRecorder: vi.fn(() => null),
}));

import { analyzeAudioDeepfakeTool } from '../../../src/agent/tools/analyze-audio-deepfake';
import { analyzeAudio, QuotaExhaustedError } from '../../../src/integrations/reality-defender';
import { takePendingAudio } from '../../../src/transport/audio-cache';
import type { PendingAudio } from '../../../src/transport/audio-cache';
import type { AudioVerdict } from '../../../src/integrations/reality-defender';

const validPendingAudio: PendingAudio = {
  buffer: Buffer.from('fake-audio'),
  mimetype: 'audio/ogg',
  durationSec: 5,
  fromName: 'Test',
  source: 'direct' as const,
  createdAt: Date.now(),
};

describe('analyzeAudioDeepfakeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error message when no pending audio in cache', async () => {
    vi.mocked(takePendingAudio).mockReturnValueOnce(null);

    const result = await analyzeAudioDeepfakeTool.invoke({});

    expect(result).toContain('No encuentro un audio');
  });

  it('returns FAKE verdict for high-score audio', async () => {
    vi.mocked(takePendingAudio).mockReturnValueOnce(validPendingAudio);
    vi.mocked(analyzeAudio).mockResolvedValueOnce({
      tier: 'fake',
      score: 0.92,
      rawStatus: 'FAKE',
      models: [{ name: 'model-1', status: 'FAKE', score: 0.92 }],
    } satisfies AudioVerdict);

    const result = await analyzeAudioDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales');
  });

  it('returns UNCERTAIN verdict for mid-score audio', async () => {
    vi.mocked(takePendingAudio).mockReturnValueOnce(validPendingAudio);
    vi.mocked(analyzeAudio).mockResolvedValueOnce({
      tier: 'uncertain',
      score: 0.55,
      rawStatus: 'UNCERTAIN',
      models: [{ name: 'model-1', status: 'UNCERTAIN', score: 0.55 }],
    } satisfies AudioVerdict);

    const result = await analyzeAudioDeepfakeTool.invoke({});

    expect(result).toContain('zona gris');
  });

  it('returns REAL verdict for low-score audio', async () => {
    vi.mocked(takePendingAudio).mockReturnValueOnce(validPendingAudio);
    vi.mocked(analyzeAudio).mockResolvedValueOnce({
      tier: 'real',
      score: 0.15,
      rawStatus: 'REAL',
      models: [{ name: 'model-1', status: 'REAL', score: 0.15 }],
    } satisfies AudioVerdict);

    const result = await analyzeAudioDeepfakeTool.invoke({});

    expect(result).toContain('parece auténtico');
  });

  it('returns friendly quota message on QuotaExhaustedError', async () => {
    vi.mocked(takePendingAudio).mockReturnValueOnce(validPendingAudio);
    vi.mocked(analyzeAudio).mockRejectedValueOnce(new QuotaExhaustedError());

    const result = await analyzeAudioDeepfakeTool.invoke({});

    expect(result).toContain('cuota mensual');
  });
});
