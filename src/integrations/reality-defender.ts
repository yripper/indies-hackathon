// Direct Reality Defender HTTP client.
//
// We previously used @realitydefender/realitydefender (the official SDK) but
// it eats the actual API response body on errors — non-4xx failures surface
// as "API error: Unknown error" with no detail about what RD's server
// actually said. For a hackathon where debug visibility matters, that's not
// good enough. This module reimplements the three calls we need:
//
//   1) POST /api/files/aws-presigned  → { signedUrl, requestId, mediaId }
//   2) PUT  <signedUrl>               → uploads the file bytes
//   3) GET  /api/media/users/{id}     → polls until status != 'ANALYZING'
//
// We log the full HTTP status + body when anything goes wrong, and retry
// idempotent GETs/POSTs once on a 5xx in case it's a transient blip.

const RD_BASE_URL = 'https://api.prd.realitydefender.xyz';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000; // 5 min — matches the SDK's default
const RETRY_DELAY_MS = 1_500;

export type MediaKind = 'audio' | 'image' | 'video' | 'document';

export type MediaVerdict = {
  // Three-tier label derived from the score per DECISION.md's "NUNCA verdict final automático" rule.
  // 'fake' → ≥0.8, 'uncertain' → 0.4–0.8, 'real' → <0.4.
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  models: Array<{ name: string; status: string; score: number | null }>;
};

// What Reality Defender accepts (mirrors @realitydefender/realitydefender
// dist/core/constants.js SUPPORTED_FILE_TYPES). Kept here so we can pre-flight
// the check locally and bail with a clear Spanish error before we touch the
// network — RD's server otherwise returns an opaque 5xx for unsupported
// formats, which is awful to surface to a panicked family.
const SUPPORTED_VIDEO = new Set(['mp4', 'mov']);
const SUPPORTED_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const SUPPORTED_AUDIO = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'alac', 'ogg']);
const SUPPORTED_TEXT = new Set(['txt']);
const SUPPORTED_ALL = new Set([
  ...SUPPORTED_VIDEO,
  ...SUPPORTED_IMAGE,
  ...SUPPORTED_AUDIO,
  ...SUPPORTED_TEXT,
]);

// Per-extension byte limits.
const SIZE_LIMITS: Record<string, number> = {
  ...Object.fromEntries([...SUPPORTED_VIDEO].map((e) => [e, 262_144_000])), // 250MB
  ...Object.fromEntries([...SUPPORTED_IMAGE].map((e) => [e, 52_428_800])), // 50MB
  ...Object.fromEntries([...SUPPORTED_AUDIO].map((e) => [e, 20_971_520])), // 20MB
  ...Object.fromEntries([...SUPPORTED_TEXT].map((e) => [e, 5_242_880])), // 5MB
};

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

function tierFromScore(score: number): MediaVerdict['tier'] {
  if (score >= FAKE_THRESHOLD) return 'fake';
  if (score >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'real';
}

// MIME → file extension, restricted to extensions Reality Defender accepts.
function extensionFromMime(mimetype: string): string | null {
  const mt = mimetype.toLowerCase();
  if (mt.startsWith('audio/ogg')) return 'ogg';
  if (mt.includes('mpeg') && mt.startsWith('audio')) return 'mp3';
  if (mt.includes('audio/mp4') || mt.includes('m4a') || mt.includes('aac')) return 'm4a';
  if (mt.includes('audio/wav') || mt.includes('audio/wave') || mt.includes('audio/x-wav')) return 'wav';
  if (mt.includes('audio/flac')) return 'flac';
  if (mt.includes('image/jpeg') || mt.includes('image/jpg')) return 'jpg';
  if (mt.includes('image/png')) return 'png';
  if (mt.includes('image/webp')) return 'webp';
  if (mt.includes('image/gif')) return 'gif';
  if (mt.includes('video/mp4')) return 'mp4';
  if (mt.includes('video/quicktime') || mt.includes('video/mov')) return 'mov';
  if (mt.includes('text/plain')) return 'txt';
  return null;
}

function pickExtension(args: {
  mimetype: string;
  fileName?: string;
  kind: MediaKind;
}): string | null {
  if (args.fileName) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(args.fileName);
    if (m) {
      const ext = m[1].toLowerCase();
      const normalized = ext === 'jpeg' ? 'jpg' : ext;
      if (SUPPORTED_ALL.has(normalized)) return normalized;
    }
  }
  const fromMime = extensionFromMime(args.mimetype);
  if (fromMime) return fromMime;
  if (args.kind === 'audio') return 'ogg';
  if (args.kind === 'image') return 'jpg';
  if (args.kind === 'video') return 'mp4';
  return null;
}

// Structured error our tool layer switches on to produce a useful Spanish
// message for the user.
export class UnsupportedMediaError extends Error {
  constructor(
    public readonly reason: 'unknown_format' | 'too_large',
    public readonly detail: string,
  ) {
    super(`Unsupported media (${reason}): ${detail}`);
    this.name = 'UnsupportedMediaError';
  }
}

// HTTP-level error from RD. Carries the real status + response body so the
// tool layer and logs can show what actually happened.
export class RealityDefenderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`RD ${path} → HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'RealityDefenderHttpError';
  }
}

export const SUPPORTED_FORMATS_BLURB =
  'mp4/mov (video), jpg/png/webp/gif (imagen), mp3/wav/m4a/aac/ogg/flac (audio), txt (texto)';

export type AnalyzeInput = {
  buffer: Buffer;
  mimetype: string;
  kind: MediaKind;
  fileName?: string;
};

type SignedUrlResponse = {
  requestId: string;
  mediaId?: string;
  response: { signedUrl: string };
  code?: string;
};

type MediaResultResponse = {
  status?: string;
  resultsSummary?: {
    status?: string;
    metadata?: { finalScore?: number | null };
  };
  models?: Array<{
    name?: string;
    status?: string | null;
    finalScore?: number | null;
  }>;
};

async function rdGetSignedUrl(
  apiKey: string,
  fileName: string,
): Promise<SignedUrlResponse> {
  const path = '/api/files/aws-presigned';
  const res = await fetch(`${RD_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[rd] ✗ ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new RealityDefenderHttpError(res.status, text, path);
  }
  return JSON.parse(text) as SignedUrlResponse;
}

async function rdUploadToSignedUrl(signedUrl: string, body: Buffer): Promise<void> {
  // S3 presigned URL upload. RD docs don't mandate a specific Content-Type;
  // application/octet-stream avoids guessing wrong on Node's side.
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    // Node 22+ fetch accepts Buffer as a valid BodyInit.
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[rd] ✗ PUT signed URL → HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new RealityDefenderHttpError(res.status, text, 'PUT signed URL');
  }
}

async function rdFetchResult(apiKey: string, requestId: string): Promise<MediaResultResponse> {
  const path = `/api/media/users/${requestId}`;
  const res = await fetch(`${RD_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'X-API-KEY': apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[rd] ✗ ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new RealityDefenderHttpError(res.status, text, path);
  }
  return JSON.parse(text) as MediaResultResponse;
}

async function pollUntilDone(
  apiKey: string,
  requestId: string,
): Promise<MediaResultResponse> {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const result = await rdFetchResult(apiKey, requestId);
    const status = result.resultsSummary?.status ?? result.status;
    if (status && status !== 'ANALYZING') {
      return result;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`RD polling timed out after ${POLL_TIMEOUT_MS}ms (requestId=${requestId})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Run an async op; if it throws an HTTP 5xx, wait briefly and try once more.
// RD's server has occasional flaps on the presigned-URL endpoint, and the
// SDK previously hid them as "Unknown error" — a single retry gets us past
// most transient blips without doubling wall-clock latency on real failures.
async function retryOn5xx<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RealityDefenderHttpError && err.status >= 500) {
      console.warn(`[rd] ${label} 5xx, retrying once in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return await fn();
    }
    throw err;
  }
}

export async function analyzeMedia(
  apiKey: string,
  input: AnalyzeInput,
): Promise<MediaVerdict> {
  if (!apiKey) {
    throw new Error('REALITY_DEFENDER_API_KEY is not set');
  }

  // Pre-flight extension + size locally so we don't burn an RD call on a
  // file the server will reject with an opaque 5xx.
  const ext = pickExtension({
    mimetype: input.mimetype,
    fileName: input.fileName,
    kind: input.kind,
  });
  if (!ext || !SUPPORTED_ALL.has(ext)) {
    throw new UnsupportedMediaError(
      'unknown_format',
      `mime="${input.mimetype}" fileName="${input.fileName ?? ''}" kind=${input.kind}`,
    );
  }
  const sizeLimit = SIZE_LIMITS[ext];
  if (sizeLimit != null && input.buffer.length > sizeLimit) {
    throw new UnsupportedMediaError(
      'too_large',
      `${(input.buffer.length / (1024 * 1024)).toFixed(1)}MB > ${(sizeLimit / (1024 * 1024)).toFixed(0)}MB para .${ext}`,
    );
  }

  // RD's docs and SDK both key off the filename's extension on the presigned
  // URL request. We use a fresh timestamped name (not a generic "media.X")
  // in case the server is doing dedup-by-name or rate-limit-by-name on its
  // side — cheap and avoids weird shared-state issues.
  const fileName = `veritas-${input.kind}-${Date.now()}.${ext}`;
  console.log(
    `[rd] ▶ analyze: kind=${input.kind} mime=${input.mimetype} ext=.${ext} ` +
      `bytes=${input.buffer.length} name="${fileName}"`,
  );

  // Step 1: get signed URL (idempotent server-side, safe to retry on 5xx).
  const signed = await retryOn5xx('aws-presigned', () => rdGetSignedUrl(apiKey, fileName));
  console.log(`[rd] ✓ got signed URL (requestId=${signed.requestId})`);

  // Step 2: upload bytes to S3. Not retrying this — it's a PUT against an
  // already-signed URL; if S3 returns 5xx we'd need a fresh presigned URL
  // anyway.
  await rdUploadToSignedUrl(signed.response.signedUrl, input.buffer);
  console.log(`[rd] ✓ uploaded ${input.buffer.length} bytes`);

  // Step 3: poll until the ensemble result lands.
  const t0 = Date.now();
  const result = await pollUntilDone(apiKey, signed.requestId);
  const dt = Date.now() - t0;
  const status =
    result.resultsSummary?.status ?? result.status ?? 'UNKNOWN';
  const score =
    typeof result.resultsSummary?.metadata?.finalScore === 'number'
      ? result.resultsSummary.metadata.finalScore
      : 0;
  console.log(
    `[rd] ◀ result in ${dt}ms (status=${status} score=${score} models=${result.models?.length ?? 0})`,
  );
  if (result.models) {
    for (const m of result.models) {
      console.log(`[rd]   model=${m.name ?? '?'} status=${m.status ?? '?'} score=${m.finalScore ?? null}`);
    }
  }

  return {
    tier: tierFromScore(score),
    score,
    rawStatus: status,
    models: (result.models ?? []).map((m) => ({
      name: m.name ?? 'unknown',
      status: m.status ?? 'UNKNOWN',
      score: typeof m.finalScore === 'number' ? m.finalScore : null,
    })),
  };
}
