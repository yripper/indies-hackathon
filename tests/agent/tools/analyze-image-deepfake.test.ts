import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules BEFORE imports (vitest hoists these)
vi.mock('../../../src/config/env', () => ({
  env: {
    REALITY_DEFENDER_API_KEY: 'test-key',
    SIGHTENGINE_API_USER: 'test-user',
    SIGHTENGINE_API_SECRET: 'test-secret',
  },
}));

vi.mock('../../../src/config/logger', () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}));

vi.mock('../../../src/integrations/reality-defender', () => ({
  analyzeImage: vi.fn(),
  QuotaExhaustedError: class QuotaExhaustedError extends Error {
    constructor() {
      super('quota');
      this.name = 'QuotaExhaustedError';
    }
  },
}));

vi.mock('../../../src/integrations/sightengine', () => ({
  detectSightengine: vi.fn(),
  topGeneratorLabel: vi.fn(() => null),
}));

vi.mock('../../../src/transport/image-cache', () => ({
  takePendingImage: vi.fn(),
}));

vi.mock('../../../src/agent/context', () => ({
  getCurrentConversationId: vi.fn(() => 'test-jid@s.whatsapp.net'),
  getProgressSender: vi.fn(() => null),
  getImageAnalysisRecorder: vi.fn(() => null),
}));

vi.mock('../../../src/rate-limit/analysis-limiter', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 5 })),
  recordAnalysis: vi.fn(),
}));

import { analyzeImageDeepfakeTool } from '../../../src/agent/tools/analyze-image-deepfake';
import { analyzeImage, QuotaExhaustedError } from '../../../src/integrations/reality-defender';
import { detectSightengine, topGeneratorLabel } from '../../../src/integrations/sightengine';
import { takePendingImage } from '../../../src/transport/image-cache';
import type { PendingImage } from '../../../src/transport/image-cache';
import type { ImageVerdict } from '../../../src/integrations/reality-defender';
import type { SightengineVerdict } from '../../../src/integrations/sightengine';

const validPendingImage: PendingImage = {
  buffer: Buffer.from('fake-image'),
  mimetype: 'image/jpeg',
  bytes: 10240,
  fromName: 'Test',
  source: 'direct' as const,
  createdAt: Date.now(),
};

function makeRdVerdict(overrides: Partial<ImageVerdict> = {}): ImageVerdict {
  return {
    tier: 'fake',
    score: 0.92,
    rawStatus: 'FAKE',
    models: [
      { name: 'rd-pine-img', status: 'FAKE', score: 0.99 },
      { name: 'rd-elm-img', status: 'FAKE', score: 0.85 },
    ],
    ...overrides,
  };
}

function makeSeVerdict(overrides: Partial<SightengineVerdict> = {}): SightengineVerdict {
  return {
    aiGenerated: 0.95,
    generators: { flux: 0.92, midjourney: 0.1 },
    deepfake: 0.3,
    requestId: 'req-123',
    ...overrides,
  };
}

describe('analyzeImageDeepfakeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error message when no pending image in cache', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(null);

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('No encuentro una imagen');
  });

  it('returns FAKE when RD fake (0.92) + SE fake (0.95)', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(makeRdVerdict({ score: 0.92 }));
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.95 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales');
    // Composite = max(0.92, 0.99*0.85=0.8415, 0.95) = 0.95 → 95%
    expect(result).toContain('95%');
  });

  it('returns FAKE when RD fake (0.85) + SE real (0.15) — RD dominates', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(
      makeRdVerdict({
        score: 0.85,
        models: [
          { name: 'rd-pine-img', status: 'FAKE', score: 0.90 },
          { name: 'rd-elm-img', status: 'UNCERTAIN', score: 0.60 },
        ],
      }),
    );
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.15 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales');
    // Composite = max(0.85, 0.90*0.85=0.765, 0.15) = 0.85 → 85%
    expect(result).toContain('85%');
  });

  it('returns FAKE when RD real (0.20) + SE fake (0.90) — SE rescues', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(
      makeRdVerdict({
        tier: 'real',
        score: 0.20,
        rawStatus: 'REAL',
        models: [
          { name: 'rd-pine-img', status: 'REAL', score: 0.25 },
          { name: 'rd-elm-img', status: 'REAL', score: 0.15 },
        ],
      }),
    );
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.90 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales');
    // Composite = max(0.20, 0.25*0.85=0.2125, 0.90) = 0.90 → 90%
    expect(result).toContain('90%');
  });

  it('returns UNCERTAIN when RD uncertain (0.55) + SE uncertain (0.50)', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(
      makeRdVerdict({
        tier: 'uncertain',
        score: 0.55,
        rawStatus: 'UNCERTAIN',
        models: [
          { name: 'rd-pine-img', status: 'UNCERTAIN', score: 0.60 },
          { name: 'rd-elm-img', status: 'UNCERTAIN', score: 0.50 },
        ],
      }),
    );
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.50 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('zona gris');
    // Composite = max(0.55, 0.60*0.85=0.51, 0.50) = 0.55 → 55%
    expect(result).toContain('55%');
  });

  it('returns REAL when RD real (0.10) + SE real (0.05)', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(
      makeRdVerdict({
        tier: 'real',
        score: 0.10,
        rawStatus: 'REAL',
        models: [
          { name: 'rd-pine-img', status: 'REAL', score: 0.12 },
          { name: 'rd-elm-img', status: 'REAL', score: 0.08 },
        ],
      }),
    );
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.05 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('parece auténtica');
    // Composite = max(0.10, 0.12*0.85=0.102, 0.05) = 0.102 → 10%
    expect(result).toContain('10%');
  });

  it('returns FAKE when RD sub-model is high (0.99) but ensemble is low (0.48) — composite rescues diluted ensemble', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(
      makeRdVerdict({
        tier: 'uncertain',
        score: 0.48,
        rawStatus: 'UNCERTAIN',
        models: [
          { name: 'rd-pine-img', status: 'FAKE', score: 0.99 },
          { name: 'rd-elm-img', status: 'REAL', score: 0.10 },
          { name: 'rd-birch-img', status: 'REAL', score: 0.05 },
        ],
      }),
    );
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.30 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    // Composite = max(0.48, 0.99*0.85=0.8415, 0.30) = 0.8415 → 84%
    expect(result).toContain('fuertes señales');
    expect(result).toContain('84%');
  });

  it('degrades gracefully when RD quota exhausted + SE available (0.88)', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockRejectedValueOnce(new QuotaExhaustedError());
    vi.mocked(detectSightengine).mockResolvedValueOnce(makeSeVerdict({ aiGenerated: 0.88 }));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales');
    // Composite = max(0, 0, 0.88) = 0.88 → 88%
    expect(result).toContain('88%');
    expect(result).toContain('no disponible');
  });

  it('returns error message when both detectors fail', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockRejectedValueOnce(new Error('RD network timeout'));
    vi.mocked(detectSightengine).mockRejectedValueOnce(new Error('SE rate limited'));

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('Error al analizar la imagen');
  });

  it('mentions generator label when topGeneratorLabel returns a value', async () => {
    vi.mocked(takePendingImage).mockReturnValueOnce(validPendingImage);
    vi.mocked(analyzeImage).mockResolvedValueOnce(makeRdVerdict({ score: 0.92 }));
    vi.mocked(detectSightengine).mockResolvedValueOnce(
      makeSeVerdict({ aiGenerated: 0.95, generators: { flux: 0.92, midjourney: 0.1 } }),
    );
    vi.mocked(topGeneratorLabel).mockReturnValueOnce('Flux');

    const result = await analyzeImageDeepfakeTool.invoke({});

    expect(result).toContain('Flux');
  });
});
