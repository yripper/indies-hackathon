import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import { detectFaceManipulationTool } from '../../../src/agent/tools/detect-face-manipulation';

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

describe('detect_face_manipulation', () => {
  it('reports fake_score using the recognized "Fake" label', async () => {
    classifyMock.mockResolvedValueOnce([
      { label: 'Fake', score: 0.93 },
      { label: 'Real', score: 0.07 },
    ]);
    const out = await detectFaceManipulationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/fake_score=0\.930/);
    expect(out).toMatch(/top_label="Fake"/);
    expect(out).toMatch(/no internal face-detection pre-filter/);
  });

  it('returns a graceful unavailable message on persistent 503', async () => {
    classifyMock.mockRejectedValueOnce(new HfInferenceError('cold start', 503));
    const out = await detectFaceManipulationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/temporarily unavailable/);
  });

  it('propagates non-503 HF errors', async () => {
    classifyMock.mockRejectedValueOnce(new HfInferenceError('rate limited', 429));
    await expect(
      detectFaceManipulationTool.invoke({ image_url: 'https://example.com/x.jpg' }),
    ).rejects.toThrow(/rate limited/);
  });

  it('falls back to top_score when labels are unrecognized', async () => {
    classifyMock.mockResolvedValueOnce([
      { label: 'cat', score: 0.6 },
      { label: 'dog', score: 0.4 },
    ]);
    const out = await detectFaceManipulationTool.invoke({
      image_url: 'https://example.com/x.jpg',
    });
    expect(out).toMatch(/top_score=0\.600/);
    expect(out).not.toMatch(/fake_score=/);
  });
});
