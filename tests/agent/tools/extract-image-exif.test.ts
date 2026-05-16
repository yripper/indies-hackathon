import { describe, it, expect, vi, afterAll } from 'vitest';
import { extractImageExifTool } from '../../../src/agent/tools/extract-image-exif';
import { exiftool } from 'exiftool-vendored';

vi.mock('../../../src/agent/tools/lib/fetch-image-buffer', () => ({
  fetchImageBuffer: vi.fn(async () => ({
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimeType: 'image/jpeg',
    byteLength: 4,
  })),
}));

vi.mock('exiftool-vendored', async () => {
  const actual = await vi.importActual<typeof import('exiftool-vendored')>('exiftool-vendored');
  return {
    ...actual,
    exiftool: {
      read: vi.fn(),
      end: vi.fn(),
    },
  };
});

const exiftoolMock = exiftool as unknown as { read: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

afterAll(async () => {
  // The mocked exiftool has an .end() stub; ensure it isn't holding open handles.
  await exiftoolMock.end?.();
});

describe('extractImageExifTool', () => {
  it('flags AI-generated images when Software matches a known generator', async () => {
    exiftoolMock.read.mockResolvedValueOnce({
      Software: 'Stable Diffusion XL 1.0',
    });
    const out = await extractImageExifTool.invoke({ image_url: 'https://example.com/a.jpg' });
    expect(out).toMatch(/Software=Stable Diffusion XL 1.0/);
    expect(out).toMatch(/Likely AI-generated/);
    expect(out).toMatch(/Caveat: metadata is easily strippable/);
  });

  it('flags a likely real camera capture when Make/Model/Lens/ISO are present', async () => {
    exiftoolMock.read.mockResolvedValueOnce({
      Make: 'Canon',
      Model: 'EOS R5',
      LensModel: 'RF 24-70mm F2.8 L IS USM',
      ISO: 400,
    });
    const out = await extractImageExifTool.invoke({ image_url: 'https://example.com/canon.jpg' });
    expect(out).toMatch(/Make=Canon/);
    expect(out).toMatch(/Model=EOS R5/);
    expect(out).toMatch(/Likely real camera capture/);
  });

  it('reports stripped metadata when tags are essentially empty', async () => {
    exiftoolMock.read.mockResolvedValueOnce({
      FileModifyDate: '2026:05:16 12:00:00',
    });
    const out = await extractImageExifTool.invoke({ image_url: 'https://example.com/wa.jpg' });
    expect(out).toMatch(/Make=\(none\)/);
    expect(out).toMatch(/Metadata appears stripped/);
  });

  it('rejects an invalid URL via Zod schema', async () => {
    await expect(
      extractImageExifTool.invoke({ image_url: 'not-a-url' }),
    ).rejects.toThrow();
  });
});
