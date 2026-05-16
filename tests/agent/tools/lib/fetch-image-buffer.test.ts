import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImageBuffer } from '../../../../src/agent/tools/lib/fetch-image-buffer';

function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string | null;
  contentLength?: string | null;
  body?: ArrayBuffer | Buffer;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentType !== null) headers.set('content-type', opts.contentType ?? 'image/jpeg');
  if (opts.contentLength != null) headers.set('content-length', opts.contentLength);

  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    } as unknown as Headers,
    arrayBuffer: async () => {
      const b = opts.body ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // mini JPEG magic
      return b instanceof Buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b;
    },
  } as unknown as Response;
}

describe('fetchImageBuffer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a buffer with mime type for a successful image response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'image/png', body: Buffer.from('fake-png-bytes') }),
    );

    const result = await fetchImageBuffer('https://example.com/x.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.byteLength).toBe(Buffer.from('fake-png-bytes').byteLength);
  });

  it('throws a descriptive error on non-OK HTTP status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: false, status: 404, statusText: 'Not Found' }),
    );
    await expect(fetchImageBuffer('https://example.com/missing.jpg')).rejects.toThrow(/HTTP 404/);
  });

  it('rejects non-image content types', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'text/html', body: Buffer.from('<html></html>') }),
    );
    await expect(fetchImageBuffer('https://example.com/page')).rejects.toThrow(
      /does not return an image/,
    );
  });

  it('rejects oversized images by content-length header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentLength: '999999999' }),
    );
    await expect(fetchImageBuffer('https://example.com/huge.jpg', { maxBytes: 1024 })).rejects.toThrow(
      /Image too large/,
    );
  });

  it('rejects oversized images discovered after download', async () => {
    const big = Buffer.alloc(2048);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentLength: null, body: big }),
    );
    await expect(fetchImageBuffer('https://example.com/big.jpg', { maxBytes: 1024 })).rejects.toThrow(
      /Image too large/,
    );
  });
});
