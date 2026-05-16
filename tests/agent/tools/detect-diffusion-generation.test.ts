import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import { detectDiffusionGenerationTool } from '../../../src/agent/tools/detect-diffusion-generation';

vi.mock('../../../src/agent/tools/lib/fetch-image-buffer', () => ({
  fetchImageBuffer: vi.fn(),
}));

vi.mock('../../../src/agent/tools/lib/hf-inference', async () => {
  const actual = await vi.importActual<typeof import('../../../src/agent/tools/lib/hf-inference')>(
    '../../../src/agent/tools/lib/hf-inference',
  );
  return {
    ...actual,
    classifyImage: vi.fn(),
  };
});

import { fetchImageBuffer } from '../../../src/agent/tools/lib/fetch-image-buffer';
import { classifyImage, HfInferenceError } from '../../../src/agent/tools/lib/hf-inference';

const fetchMock = fetchImageBuffer as unknown as ReturnType<typeof vi.fn>;
const classifyMock = classifyImage as unknown as ReturnType<typeof vi.fn>;

async function tinyJpeg(): Promise<Buffer> {
  return await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();
}

beforeEach(async () => {
  fetchMock.mockReset();
  classifyMock.mockReset();
  const buf = await tinyJpeg();
  fetchMock.mockResolvedValue({ buffer: buf, mimeType: 'image/jpeg', byteLength: buf.byteLength });
});

describe('detect_diffusion_generation', () => {
  it('reports synthetic_score using the recognized "artificial" label', async () => {
    classifyMock.mockResolvedValueOnce([
      { label: 'artificial', score: 0.89 },
      { label: 'human', score: 0.11 },
    ]);
    const out = await detectDiffusionGenerationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/synthetic_score=0\.890/);
    expect(out).toMatch(/top_label="artificial"/);
    expect(out).toMatch(/Threshold guidance/);
    expect(out).toMatch(/Caveat/);
  });

  it('falls back to top_score when no recognized synthetic label is present', async () => {
    classifyMock.mockResolvedValueOnce([
      { label: 'cat', score: 0.7 },
      { label: 'dog', score: 0.3 },
    ]);
    const out = await detectDiffusionGenerationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/top_score=0\.700/);
    expect(out).not.toMatch(/synthetic_score=/);
  });

  it('returns a graceful unavailable message on persistent 503', async () => {
    classifyMock.mockRejectedValueOnce(new HfInferenceError('cold start', 503));
    const out = await detectDiffusionGenerationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/temporarily unavailable/);
  });

  it('propagates non-503 HF errors', async () => {
    classifyMock.mockRejectedValueOnce(new HfInferenceError('forbidden', 403));
    await expect(
      detectDiffusionGenerationTool.invoke({ image_url: 'https://example.com/x.jpg' }),
    ).rejects.toThrow(/forbidden/);
  });
});
