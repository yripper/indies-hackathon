import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock certificate helper and request-context so they don't need real I/O
vi.mock('../../../src/utils/certificate', () => ({
  maybeBuildCertificate: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/utils/request-context', () => ({
  getSendImage: vi.fn(() => undefined),
}));

import { analyzeAudioDeepfakeTool } from '../../../src/agent/tools/analyze-audio-deepfake';

const AUDIO_URL = 'https://example.com/audio.ogg';

function mockFetchResponse(body: object, ok = true, status = 200) {
  const response = {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('analyzeAudioDeepfakeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns FAKE verdict for high-confidence audio', async () => {
    // First fetch: download the audio file; second fetch: POST to analyze-audio
    const audioBuffer = new ArrayBuffer(16);
    const analyzeResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ verdict: 'FAKE', confidence: 0.92, detail: 'fuertes señales de síntesis' }),
      text: vi.fn().mockResolvedValue(''),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    const downloadResponse = {
      ok: true,
      status: 200,
      json: vi.fn(),
      text: vi.fn(),
      arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(downloadResponse)
      .mockResolvedValueOnce(analyzeResponse),
    );

    const result = await analyzeAudioDeepfakeTool.invoke({ audioSource: AUDIO_URL });

    expect(result).toContain('FAKE');
    expect(result).toContain('92%');
    expect(result).toContain('fuertes señales');
  });

  it('returns REAL verdict for low-confidence audio', async () => {
    const audioBuffer = new ArrayBuffer(16);
    const analyzeResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ verdict: 'REAL', confidence: 0.15, detail: 'parece auténtico' }),
      text: vi.fn().mockResolvedValue(''),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    const downloadResponse = {
      ok: true,
      status: 200,
      json: vi.fn(),
      text: vi.fn(),
      arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(downloadResponse)
      .mockResolvedValueOnce(analyzeResponse),
    );

    const result = await analyzeAudioDeepfakeTool.invoke({ audioSource: AUDIO_URL });

    expect(result).toContain('REAL');
    expect(result).toContain('15%');
    expect(result).toContain('parece auténtico');
  });

  it('returns UNCERTAIN verdict for mid-confidence audio', async () => {
    const audioBuffer = new ArrayBuffer(16);
    const analyzeResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ verdict: 'UNCERTAIN', confidence: 0.55, detail: 'zona gris' }),
      text: vi.fn().mockResolvedValue(''),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    const downloadResponse = {
      ok: true,
      status: 200,
      json: vi.fn(),
      text: vi.fn(),
      arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(downloadResponse)
      .mockResolvedValueOnce(analyzeResponse),
    );

    const result = await analyzeAudioDeepfakeTool.invoke({ audioSource: AUDIO_URL });

    expect(result).toContain('UNCERTAIN');
    expect(result).toContain('55%');
    expect(result).toContain('zona gris');
  });

  it('throws when the analysis service returns a non-ok status', async () => {
    const audioBuffer = new ArrayBuffer(16);
    const analyzeResponse = {
      ok: false,
      status: 500,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('Internal Server Error'),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    const downloadResponse = {
      ok: true,
      status: 200,
      json: vi.fn(),
      text: vi.fn(),
      arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(downloadResponse)
      .mockResolvedValueOnce(analyzeResponse),
    );

    await expect(
      analyzeAudioDeepfakeTool.invoke({ audioSource: AUDIO_URL }),
    ).rejects.toThrow(/Audio deepfake service error/);
  });

  it('throws when the audio download fails', async () => {
    const downloadResponse = {
      ok: false,
      status: 404,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('Not Found'),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(downloadResponse));

    await expect(
      analyzeAudioDeepfakeTool.invoke({ audioSource: AUDIO_URL }),
    ).rejects.toThrow(/Error al descargar audio/);
  });
});
