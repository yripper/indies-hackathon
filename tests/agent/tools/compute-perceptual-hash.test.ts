import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {
  createComputePerceptualHashTool,
  computePdqFromImageBuffer,
} from '../../../src/agent/tools/compute-perceptual-hash';
import { clearBlocklistCache } from '../../../src/agent/tools/lib/load-blocklist';

vi.mock('../../../src/agent/tools/lib/fetch-image-buffer', () => ({
  fetchImageBuffer: vi.fn(),
}));

import { fetchImageBuffer } from '../../../src/agent/tools/lib/fetch-image-buffer';
const fetchMock = fetchImageBuffer as unknown as ReturnType<typeof vi.fn>;

async function tinyJpeg(rgb: [number, number, number]): Promise<Buffer> {
  // Generate a 16x16 solid-color JPEG buffer with sharp.
  return await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .jpeg()
    .toBuffer();
}

beforeEach(() => clearBlocklistCache());

describe('computePdqFromImageBuffer', () => {
  it('produces a 64-char hex hash for a valid JPEG', async () => {
    const buf = await tinyJpeg([200, 100, 50]);
    const { hash, quality } = await computePdqFromImageBuffer(buf);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(quality).toBeGreaterThanOrEqual(0);
    expect(quality).toBeLessThanOrEqual(100);
  });

  it('produces identical hashes for identical images', async () => {
    const a = await tinyJpeg([10, 20, 30]);
    const b = await tinyJpeg([10, 20, 30]);
    const ha = await computePdqFromImageBuffer(a);
    const hb = await computePdqFromImageBuffer(b);
    expect(ha.hash).toBe(hb.hash);
  });
});

describe('createComputePerceptualHashTool', () => {
  it('reports no match when blocklist is empty', async () => {
    fetchMock.mockResolvedValueOnce({
      buffer: await tinyJpeg([5, 10, 15]),
      mimeType: 'image/jpeg',
      byteLength: 1,
    });
    const tool = createComputePerceptualHashTool({
      blocklist_path: '/does/not/exist.jsonl',
      hamming_threshold: 8,
    });
    const out = await tool.invoke({ image_url: 'https://example.com/x.jpg' });
    expect(out).toMatch(/Perceptual hash \(PDQ\): [0-9a-f]{64}/);
    expect(out).toMatch(/No match in blocklist/);
  });

  it('reports a match when the image hash is in the blocklist', async () => {
    const buf = await tinyJpeg([100, 100, 100]);
    fetchMock.mockResolvedValueOnce({
      buffer: buf,
      mimeType: 'image/jpeg',
      byteLength: buf.byteLength,
    });

    // Compute the hash directly first so we can plant it in the blocklist
    const { hash } = await computePdqFromImageBuffer(buf);

    const blocklistFile = path.join(os.tmpdir(), `bl-match-${Date.now()}.jsonl`);
    writeFileSync(
      blocklistFile,
      JSON.stringify({
        hash,
        algo: 'pdq',
        source: 'victim-report',
        added_at: '2026-05-16',
        case_id: 'case_xyz',
      }) + '\n',
      'utf8',
    );

    fetchMock.mockResolvedValueOnce({
      buffer: buf,
      mimeType: 'image/jpeg',
      byteLength: buf.byteLength,
    });
    const tool = createComputePerceptualHashTool({
      blocklist_path: blocklistFile,
      hamming_threshold: 8,
    });
    const out = await tool.invoke({ image_url: 'https://example.com/x.jpg' });
    expect(out).toMatch(/MATCH in blocklist/);
    expect(out).toMatch(/source=victim-report/);
    expect(out).toMatch(/case_id=case_xyz/);
    expect(out).toMatch(/hamming_distance=0 bits/);

    unlinkSync(blocklistFile);
  });
});
