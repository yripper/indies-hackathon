import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock must be at top-level — Vitest hoists it before imports
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { detectDeepfakeVideoTool } from '../../../src/agent/tools/detect-deepfake-video';

const FAKE_RESPONSE = {
  verdict: 'FAKE',
  confidence: 0.87,
  faces_found: 16,
  frames_analyzed: 20,
  temporal_inconsistency: 0.14,
  detail: '16 rostros analizados en 20 frames',
};

const REAL_RESPONSE = {
  verdict: 'REAL',
  confidence: 0.21,
  faces_found: 18,
  frames_analyzed: 20,
  temporal_inconsistency: 0.03,
  detail: '18 rostros analizados en 20 frames',
};

function mockFetch(...responses: Partial<Response>[]) {
  const spy = vi.spyOn(global, 'fetch');
  for (const r of responses) {
    spy.mockResolvedValueOnce(r as Response);
  }
  return spy;
}

function okDownload() {
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
}

function okService(body: object) {
  return { ok: true, json: async () => body } as Response;
}

describe('detectDeepfakeVideoTool', () => {
  beforeEach(() => {
    process.env.DEEPFAKE_SERVICE_URL = 'http://localhost:7860';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEEPFAKE_SERVICE_URL;
  });

  describe('URL video source', () => {
    it('returns FAKE verdict and formats confidence correctly', async () => {
      mockFetch(okDownload(), okService(FAKE_RESPONSE));

      const result = await detectDeepfakeVideoTool.invoke({
        videoSource: 'https://example.com/video.mp4',
      });

      expect(result).toContain('FAKE');
      expect(result).toContain('87%');
      expect(result).toContain('16 rostros');
    });

    it('returns REAL verdict', async () => {
      mockFetch(okDownload(), okService(REAL_RESPONSE));

      const result = await detectDeepfakeVideoTool.invoke({
        videoSource: 'https://example.com/real.mp4',
      });

      expect(result).toContain('REAL');
      expect(result).toContain('21%');
    });

    it('includes temporal inconsistency percentage in output', async () => {
      mockFetch(okDownload(), okService(FAKE_RESPONSE));

      const result = await detectDeepfakeVideoTool.invoke({
        videoSource: 'https://example.com/video.mp4',
      });

      // temporal_inconsistency: 0.14 → 14%
      expect(result).toContain('14%');
    });

    it('throws when video download fails', async () => {
      mockFetch({ ok: false, status: 404 } as Response);

      await expect(
        detectDeepfakeVideoTool.invoke({ videoSource: 'https://example.com/missing.mp4' }),
      ).rejects.toThrow('404');
    });

    it('throws on 500 from deepfake service', async () => {
      mockFetch(
        okDownload(),
        { ok: false, status: 500, text: async () => 'internal error' } as Response,
      );

      await expect(
        detectDeepfakeVideoTool.invoke({ videoSource: 'https://example.com/video.mp4' }),
      ).rejects.toThrow('500');
    });
  });

  describe('local file source', () => {
    it('reads file from disk and posts to service', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('fake-video-bytes') as never);
      mockFetch(okService(FAKE_RESPONSE));

      const result = await detectDeepfakeVideoTool.invoke({
        videoSource: '/tmp/wa_video_1234567890.mp4',
      });

      expect(result).toContain('FAKE');
      expect(vi.mocked(readFile)).toHaveBeenCalledWith('/tmp/wa_video_1234567890.mp4');
    });
  });
});
