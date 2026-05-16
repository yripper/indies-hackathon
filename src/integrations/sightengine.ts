// Sightengine genai + deepfake image detection.
// REST endpoint, multipart/form-data. Node 22 built-in fetch.
// Free tier: 2000 ops/month, 500/day, 1 req/s.
// Docs: https://sightengine.com/docs/ai-generated-image-detection

import { logger } from '../config/logger';

const log = logger.child({ module: 'sightengine' });
const ENDPOINT = 'https://api.sightengine.com/1.0/check.json';

export type SightengineGenerator =
  | 'dalle' | 'firefly' | 'flux' | 'gan' | 'gpt' | 'higgsfield'
  | 'ideogram' | 'kling' | 'imagen' | 'midjourney' | 'qwen'
  | 'recraft' | 'reve' | 'seedream' | 'stable_diffusion' | 'wan'
  | 'z_image' | 'other';

export type SightengineVerdict = {
  aiGenerated: number;
  generators: Partial<Record<SightengineGenerator, number>>;
  deepfake: number | null;
  requestId: string;
};

type RawResponse = {
  status: string;
  request?: { id?: string };
  type?: {
    ai_generated?: number;
    ai_generators?: Partial<Record<SightengineGenerator, number>>;
    deepfake?: number;
  };
  error?: { type?: string; code?: number; message?: string };
};

export type SightengineConfig = {
  apiUser: string;
  apiSecret: string;
  models?: ReadonlyArray<'genai' | 'deepfake'>;
};

export type SightengineInput = {
  buffer: Buffer;
  mimetype: string;
};

function filenameForMime(mimetype: string): string {
  const m = mimetype.toLowerCase();
  if (m.includes('png')) return 'image.png';
  if (m.includes('webp')) return 'image.webp';
  if (m.includes('heic') || m.includes('heif')) return 'image.heic';
  if (m.includes('gif')) return 'image.gif';
  return 'image.jpg';
}

export async function detectSightengine(
  config: SightengineConfig,
  input: SightengineInput,
): Promise<SightengineVerdict> {
  if (!config.apiUser || !config.apiSecret) {
    throw new Error('SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET are not set');
  }

  const models = (config.models ?? ['genai']).join(',');
  const fd = new FormData();
  fd.append('media', new Blob([Uint8Array.from(input.buffer)], { type: input.mimetype }), filenameForMime(input.mimetype));
  fd.append('models', models);
  fd.append('api_user', config.apiUser);
  fd.append('api_secret', config.apiSecret);

  log.info({ bytes: input.buffer.length, mime: input.mimetype, models }, 'uploading to Sightengine');
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
  const dt = Date.now() - t0;
  const raw = (await res.json()) as RawResponse;

  if (!res.ok || raw.status !== 'success') {
    const code = raw.error?.code ?? res.status;
    const msg = raw.error?.message ?? raw.error?.type ?? `HTTP ${res.status}`;
    log.error({ code, msg }, 'Sightengine request failed');
    throw new Error(`Sightengine error (${code}): ${msg}`);
  }

  const aiGenerated = typeof raw.type?.ai_generated === 'number' ? raw.type.ai_generated : 0;
  const generators = raw.type?.ai_generators ?? {};
  const deepfake = typeof raw.type?.deepfake === 'number' ? raw.type.deepfake : null;

  log.info(
    { latencyMs: dt, aiGenerated, deepfake, generators: Object.keys(generators).length },
    'detection complete',
  );

  const topGen = Object.entries(generators)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => (b[1] as number) - (a[1] as number))[0];
  if (topGen) {
    log.debug({ generator: topGen[0], score: topGen[1] }, 'top generator');
  }

  return { aiGenerated, generators, deepfake, requestId: raw.request?.id ?? '' };
}

const GENERATOR_LABELS: Record<SightengineGenerator, string> = {
  dalle: 'DALL·E', firefly: 'Adobe Firefly', flux: 'Flux',
  gan: 'GAN (StyleGAN/similar)', gpt: 'GPT-image', higgsfield: 'Higgsfield',
  ideogram: 'Ideogram', kling: 'Kling', imagen: 'Google Imagen/Gemini',
  midjourney: 'MidJourney', qwen: 'Qwen', recraft: 'Recraft', reve: 'Reve',
  seedream: 'Seedream', stable_diffusion: 'Stable Diffusion', wan: 'Wan',
  z_image: 'Z-Image', other: 'modelo no identificado',
};

export function topGeneratorLabel(
  generators: Partial<Record<SightengineGenerator, number>>,
): string | null {
  const ranked = Object.entries(generators)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  const top = ranked[0];
  if (!top || (top[1] as number) < 0.7) return null;
  return GENERATOR_LABELS[top[0] as SightengineGenerator] ?? top[0];
}
