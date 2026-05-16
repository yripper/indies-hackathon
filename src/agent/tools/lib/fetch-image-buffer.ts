/**
 * Fetch an image from a public URL into a Node Buffer with a size cap and
 * timeout. Used by every image-detection tool so they don't reimplement HTTP
 * handling — the LLM only sees one consistent error shape across tools.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ImageFetchResult {
  buffer: Buffer;
  mimeType: string;
  byteLength: number;
}

export interface FetchImageOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchImageBuffer(
  url: string,
  opts: FetchImageOptions = {},
): Promise<ImageFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `Image fetch failed: HTTP ${res.status} ${res.statusText} for ${url}`,
      );
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(
        `Image too large: ${contentLength} bytes exceeds limit of ${maxBytes}`,
      );
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      throw new Error(
        `URL does not return an image (got content-type "${contentType || 'unknown'}").`,
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `Image too large: ${buffer.byteLength} bytes exceeds limit of ${maxBytes}`,
      );
    }

    return { buffer, mimeType: contentType, byteLength: buffer.byteLength };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${timeoutMs}ms for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
