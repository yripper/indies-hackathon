import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must precede imports — vitest hoists them.
vi.mock('../../../src/config/logger', () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  // Return a resolved Promise so the tool's .catch() chain works.
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/transport/video-cache', () => ({
  takePendingVideo: vi.fn(),
}));

vi.mock('../../../src/agent/context', () => ({
  getCurrentConversationId: vi.fn(() => 'test-jid@s.whatsapp.net'),
  getProgressSender: vi.fn(() => null),
}));

import { readFile } from 'node:fs/promises';
import { analyzeVideoDeepfakeTool } from '../../../src/agent/tools/analyze-video-deepfake';
import { takePendingVideo } from '../../../src/transport/video-cache';
import { getCurrentConversationId, getProgressSender } from '../../../src/agent/context';

const PENDING = {
  filePath: '/tmp/wa_video_test.mp4',
  mimetype: 'video/mp4',
  bytes: 1_500_000,
  fromName: 'Test User',
  source: 'direct' as const,
  createdAt: Date.now(),
};

function mockServiceResponse(body: object, status = 200): void {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe('analyzeVideoDeepfakeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEEPFAKE_SERVICE_URL = 'http://localhost:7860';
    vi.mocked(takePendingVideo).mockReturnValue(PENDING);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-video-bytes'));
    vi.mocked(getCurrentConversationId).mockReturnValue('test-jid@s.whatsapp.net');
    vi.mocked(getProgressSender).mockReturnValue(null);
  });

  it('returns a fake-tier verdict when service reports high-confidence FAKE', async () => {
    mockServiceResponse({
      verdict: 'FAKE',
      confidence: 0.87,
      faces_found: 16,
      frames_analyzed: 20,
      temporal_inconsistency: 0.14,
      detail: '16 rostros analizados en 20 frames',
    });

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('fuertes señales de ser un deepfake');
    expect(result).toContain('87%');
    expect(result).toContain('Detalle técnico');
    expect(result).toContain('FAKE');
  });

  it('returns an uncertain-tier verdict when FAKE confidence is mid-range', async () => {
    mockServiceResponse({
      verdict: 'FAKE',
      confidence: 0.55,
      faces_found: 12,
      frames_analyzed: 20,
      temporal_inconsistency: 0.08,
      detail: 'parcialmente inconsistente',
    });

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('no se pone de acuerdo');
    expect(result).toContain('zona gris');
    expect(result).toContain('55%');
  });

  it('returns a real-tier verdict when service reports REAL', async () => {
    mockServiceResponse({
      verdict: 'REAL',
      confidence: 0.21,
      faces_found: 18,
      frames_analyzed: 20,
      temporal_inconsistency: 0.03,
      detail: '18 rostros analizados',
    });

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('parece auténtico');
    expect(result).toContain('21%');
  });

  it('returns a friendly Spanish error when the service is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('No pude contactar al servicio');
    expect(result).toContain('docker compose --profile ml up deepfake');
  });

  it('returns cache-miss message when no video is pending', async () => {
    vi.mocked(takePendingVideo).mockReturnValueOnce(null);

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('No encuentro un video reciente');
    expect(global.fetch).not.toHaveBeenCalled?.();
  });

  it('returns identification error when ALS has no conversation id', async () => {
    vi.mocked(getCurrentConversationId).mockReturnValueOnce(null);

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('Error interno');
    expect(takePendingVideo).not.toHaveBeenCalled();
  });

  it('surfaces non-200 service errors with the status code', async () => {
    mockServiceResponse({ error: 'too large' }, 413);

    const result = await analyzeVideoDeepfakeTool.invoke({});

    expect(result).toContain('413');
    expect(result).toContain('Probá de nuevo');
  });
});
