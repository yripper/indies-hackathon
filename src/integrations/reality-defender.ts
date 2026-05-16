import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RealityDefender } from '@realitydefender/realitydefender';

export type AudioVerdict = {
  // Three-tier label derived from the score per DECISION.md's "NUNCA verdict final automático" rule.
  // 'fake' → ≥0.8, 'uncertain' → 0.4–0.8, 'real' → <0.4.
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  models: Array<{ name: string; score: number | null }>;
};

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

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

  console.log(
    `[rd] ▶ uploading ${filePath} (mime=${input.mimetype}, ${input.buffer.length} bytes)`,
  );

  try {
    const rd = new RealityDefender({ apiKey });
    const t0 = Date.now();
    const result = await rd.detect({ filePath });
    const dt = Date.now() - t0;
    console.log(
      `[rd] ◀ result in ${dt}ms: status=${result.status} score=${result.score} models=${result.models?.length ?? 0}`,
    );
    if (result.models) {
      for (const m of result.models) {
        console.log(`[rd]   model=${m.name} status=${m.status} score=${m.score}`);
      }
    }
    const score = typeof result.score === 'number' ? result.score : 0;
    return {
      tier: tierFromScore(score),
      score,
      rawStatus: result.status ?? 'UNKNOWN',
      models: (result.models ?? []).map((m) => ({
        name: m.name,
        score: typeof m.score === 'number' ? m.score : null,
      })),
    };
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
