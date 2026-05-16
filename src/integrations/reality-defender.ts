import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RealityDefender } from '@realitydefender/realitydefender';
import { logger } from '../config/logger';

const log = logger.child({ module: 'reality-defender' });

export type AudioVerdict = {
  // Three-tier label derived from the score per DECISION.md's "NUNCA verdict final automático" rule.
  // 'fake' → ≥0.8, 'uncertain' → 0.4–0.8, 'real' → <0.4.
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  models: Array<{ name: string; status: string; score: number | null }>;
};

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

/**
 * Thrown when Reality Defender signals the monthly free-tier quota (50 scans)
 * has been exhausted. The tool layer catches this and returns a friendly
 * Spanish-language explanation to the user.
 */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Reality Defender monthly quota exhausted (50 free scans/month)');
    this.name = 'QuotaExhaustedError';
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  // HTTP status check (if the SDK exposes it)
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
    if (e.status === 429 || e.statusCode === 429) return true;
    if (e.code === 'rate_limit_exceeded' || e.code === 'quota_exceeded') return true;
    // Message heuristic — covers SDK wrappers that embed the reason in text
    const msg = (e.message ?? '').toLowerCase();
    if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('limit exceeded'))
      return true;
  }
  return false;
}

function tierFromScore(score: number): AudioVerdict['tier'] {
  if (score >= FAKE_THRESHOLD) return 'fake';
  if (score >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'real';
}

function extensionForMime(mimetype: string): string {
  // WhatsApp voice notes come as 'audio/ogg; codecs=opus'. RD accepts .ogg natively.
  if (mimetype.startsWith('audio/ogg')) return 'ogg';
  if (mimetype.includes('mpeg')) return 'mp3';
  if (mimetype.includes('mp4') || mimetype.includes('m4a') || mimetype.includes('aac')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('flac')) return 'flac';
  return 'ogg';
}

export type AnalyzeInput = {
  buffer: Buffer;
  mimetype: string;
};

export async function analyzeAudio(
  apiKey: string,
  input: AnalyzeInput,
): Promise<AudioVerdict> {
  if (!apiKey) {
    throw new Error('REALITY_DEFENDER_API_KEY is not set');
  }

  // RD SDK requires filePath (no buffer overload). Write to OS tmp dir,
  // analyze, then unlink — even on failure, so we don't leak audio bytes.
  const dir = await mkdtemp(path.join(tmpdir(), 'rd-'));
  const ext = extensionForMime(input.mimetype);
  const filePath = path.join(dir, `audio.${ext}`);
  await writeFile(filePath, input.buffer);

  log.info(
    { filePath, mime: input.mimetype, bytes: input.buffer.length },
    'uploading to Reality Defender',
  );

  try {
    const rd = new RealityDefender({ apiKey });
    const t0 = Date.now();
    const result = await rd.detect({ filePath });
    const dt = Date.now() - t0;
    log.info(
      { latencyMs: dt, status: result.status, score: result.score, models: result.models?.length ?? 0 },
      'detection complete',
    );
    if (result.models) {
      for (const m of result.models) {
        log.debug({ model: m.name, status: m.status, score: m.score }, 'model result');
      }
    }
    const score = typeof result.score === 'number' ? result.score : 0;
    return {
      tier: tierFromScore(score),
      score,
      rawStatus: result.status ?? 'UNKNOWN',
      models: (result.models ?? []).map((m) => ({
        name: m.name,
        status: m.status ?? 'UNKNOWN',
        score: typeof m.score === 'number' ? m.score : null,
      })),
    };
  } catch (err: unknown) {
    // Detect quota exhaustion (HTTP 429 or message containing quota keywords)
    // and re-throw with a recognizable message so the tool can surface a
    // user-friendly explanation instead of raw API gibberish.
    if (isQuotaError(err)) {
      throw new QuotaExhaustedError();
    }
    throw err;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

export type ImageVerdict = {
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  models: Array<{ name: string; status: string; score: number | null }>;
};

function extensionForImageMime(mimetype: string): string {
  const m = mimetype.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

export type AnalyzeImageInput = {
  buffer: Buffer;
  mimetype: string;
};

export async function analyzeImage(
  apiKey: string,
  input: AnalyzeImageInput,
): Promise<ImageVerdict> {
  if (!apiKey) {
    throw new Error('REALITY_DEFENDER_API_KEY is not set');
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'rd-img-'));
  const ext = extensionForImageMime(input.mimetype);
  const filePath = path.join(dir, `image.${ext}`);
  await writeFile(filePath, input.buffer);

  log.info({ filePath, mime: input.mimetype, bytes: input.buffer.length }, 'uploading image to Reality Defender');

  try {
    const rd = new RealityDefender({ apiKey });
    const t0 = Date.now();
    const result = await rd.detect({ filePath });
    const dt = Date.now() - t0;
    log.info(
      { latencyMs: dt, status: result.status, score: result.score, models: result.models?.length ?? 0 },
      'image detection complete',
    );
    if (result.models) {
      for (const m of result.models) {
        log.debug({ model: m.name, status: m.status, score: m.score }, 'image model result');
      }
    }
    const score = typeof result.score === 'number' ? result.score : 0;
    return {
      tier: tierFromScore(score),
      score,
      rawStatus: result.status ?? 'UNKNOWN',
      models: (result.models ?? []).map((m) => ({
        name: m.name,
        status: m.status ?? 'UNKNOWN',
        score: typeof m.score === 'number' ? m.score : null,
      })),
    };
  } catch (err: unknown) {
    if (isQuotaError(err)) {
      throw new QuotaExhaustedError();
    }
    throw err;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
