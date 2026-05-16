import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RealityDefender } from '@realitydefender/realitydefender';

export type ImageVerdict = {
  // Three-tier label derived from the score. 'fake' → ≥0.8, 'uncertain' →
  // 0.4–0.8, 'real' → <0.4. Kept here (not in the LLM prompt) so the agent
  // can't soften the verdict on its own.
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  models: Array<{ name: string; status: string; score: number | null }>;
};

const FAKE_THRESHOLD = 0.8;
const UNCERTAIN_THRESHOLD = 0.4;

function tierFromScore(score: number): ImageVerdict['tier'] {
  if (score >= FAKE_THRESHOLD) return 'fake';
  if (score >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'real';
}

function extensionForImageMime(mimetype: string): string {
  // WhatsApp delivers images as JPEG by default but the user can forward
  // PNG/WebP/HEIC from other clients. RD routes by file extension, so map
  // mime → ext rather than trusting whatever WhatsApp claims.
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

  // RD SDK requires filePath (no buffer overload). Write to OS tmp dir,
  // analyze, then unlink — even on failure, so we don't leak image bytes.
  const dir = await mkdtemp(path.join(tmpdir(), 'rd-img-'));
  const ext = extensionForImageMime(input.mimetype);
  const filePath = path.join(dir, `image.${ext}`);
  await writeFile(filePath, input.buffer);

  console.log(
    `[rd:image] ▶ uploading ${filePath} (mime=${input.mimetype}, ${input.buffer.length} bytes)`,
  );

  try {
    const rd = new RealityDefender({ apiKey });
    const t0 = Date.now();
    const result = await rd.detect({ filePath });
    const dt = Date.now() - t0;
    console.log(
      `[rd:image] ◀ result in ${dt}ms: status=${result.status} score=${result.score} models=${result.models?.length ?? 0}`,
    );
    if (result.models) {
      for (const m of result.models) {
        console.log(`[rd:image]   model=${m.name} status=${m.status} score=${m.score}`);
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
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
