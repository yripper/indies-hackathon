import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock certificate helper and request-context so they don't need real I/O
vi.mock('../../../src/utils/certificate', () => ({
  maybeBuildCertificate: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/utils/request-context', () => ({
  getSendImage: vi.fn(() => undefined),
}));

import { analyzeImageDeepfakeTool } from '../../../src/agent/tools/analyze-image-deepfake';

const IMAGE_URL = 'https://example.com/image.jpg';

function makeDownloadResponse(buffer = new ArrayBuffer(16)): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(),
    text: vi.fn(),
    arrayBuffer: vi.fn().mockResolvedValue(buffer),
  } as unknown as Response;
}

function makeAnalyzeResponse(verdict: string, confidence: number, detail: string): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ verdict, confidence, detail }),
    text: vi.fn().mockResolvedValue(''),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as Response;
}

describe('analyzeImageDeepfakeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns FAKE verdict for high-confidence image', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.92, 'fuertes señales de manipulación')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('FAKE');
    expect(result).toContain('92%');
    expect(result).toContain('fuertes señales');
  });

  it('returns REAL verdict for low-confidence image', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('REAL', 0.10, 'parece auténtica')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('REAL');
    expect(result).toContain('10%');
    expect(result).toContain('parece auténtica');
  });

  it('returns UNCERTAIN verdict for mid-confidence image', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('UNCERTAIN', 0.55, 'zona gris')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('UNCERTAIN');
    expect(result).toContain('55%');
    expect(result).toContain('zona gris');
  });

  it('rounds confidence to nearest integer percentage', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.8415, 'detail')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    // Math.round(0.8415 * 100) = 84
    expect(result).toContain('84%');
  });

  it('returns 95% for confidence 0.95', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.95, 'fuertes señales')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('95%');
  });

  it('returns 85% for confidence 0.85', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.85, 'fuertes señales')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('85%');
  });

  it('returns 88% for confidence 0.88', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.88, 'fuertes señales')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('88%');
  });

  it('returns 90% for confidence 0.90', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(makeAnalyzeResponse('FAKE', 0.90, 'fuertes señales')),
    );

    const result = await analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL });

    expect(result).toContain('90%');
  });

  it('throws when the analysis service returns a non-ok status', async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('Internal Server Error'),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDownloadResponse())
      .mockResolvedValueOnce(errorResponse),
    );

    await expect(
      analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL }),
    ).rejects.toThrow(/Image deepfake service error/);
  });

  it('throws when the image download fails', async () => {
    const downloadFail = {
      ok: false,
      status: 404,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('Not Found'),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(downloadFail));

    await expect(
      analyzeImageDeepfakeTool.invoke({ imageSource: IMAGE_URL }),
    ).rejects.toThrow(/Error al descargar imagen/);
  });
});
