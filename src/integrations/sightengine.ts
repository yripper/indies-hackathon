// Sightengine `genai` (+ optional `deepfake`) image detection. Used as a
// second-opinion detector alongside Reality Defender. Trained specifically
// on Flux, MidJourney, GPT-image, Gemini/Imagen, Stable Diffusion, DALL·E,
// Firefly, Ideogram, Recraft, Reve, Seedream and others — i.e. the modern
// generators that RD's image ensemble tends to under-flag.
//
// REST endpoint, multipart/form-data. No SDK install — Node 22's built-in
// fetch + FormData + Blob handle this.
//
// Docs: https://sightengine.com/docs/ai-generated-image-detection
// Pricing: free tier = 2000 ops/month, 500/day, 1 req/s.

const ENDPOINT = 'https://api.sightengine.com/1.0/check.json';

export type SightengineGenerator =
  | 'dalle'
  | 'firefly'
  | 'flux'
  | 'gan'
  | 'gpt'
  | 'higgsfield'
  | 'ideogram'
  | 'kling'
  | 'imagen'
  | 'midjourney'
  | 'qwen'
  | 'recraft'
  | 'reve'
  | 'seedream'
  | 'stable_diffusion'
  | 'wan'
  | 'z_image'
  | 'other';

export type SightengineVerdict = {
  // Global AI-generated probability (0-1). Sightengine's headline score.
  aiGenerated: number;
  // Per-generator confidence breakdown. Keys are Sightengine generator slugs;
  // values 0-1. Empty when the API didn't include them (older responses).
  generators: Partial<Record<SightengineGenerator, number>>;
  // Optional deepfake score (face-swap / face-manipulation). Present when the
  // `deepfake` model was requested alongside `genai`. 0-1, null if not requested.
  deepfake: number | null;
  // Raw request id for debugging / support.
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
  // Models to run in one call. genai by default; pass ['genai', 'deepfake']
  // for both. Multiple models bundle into a single billed operation per
  // model (so 'genai,deepfake' = 2 operations).
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
  // Blob + filename: Sightengine routes by file extension just like RD does,
  // so pick the right name from the mime type or it will misclassify HEIC
  // payloads as JPEG and reject them.
  fd.append('media', new Blob([new Uint8Array(input.buffer)], { type: input.mimetype }), filenameForMime(input.mimetype));
  fd.append('models', models);
  fd.append('api_user', config.apiUser);
  fd.append('api_secret', config.apiSecret);

  console.log(
    `[sightengine] ▶ uploading ${input.buffer.length} bytes (mime=${input.mimetype}, models=${models})`,
  );
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
  const dt = Date.now() - t0;
  const raw = (await res.json()) as RawResponse;

  if (!res.ok || raw.status !== 'success') {
    const code = raw.error?.code ?? res.status;
    const msg = raw.error?.message ?? raw.error?.type ?? `HTTP ${res.status}`;
    console.error(`[sightengine] ✗ ${code}: ${msg}`);
    throw new Error(`Sightengine error (${code}): ${msg}`);
  }

  const aiGenerated = typeof raw.type?.ai_generated === 'number' ? raw.type.ai_generated : 0;
  const generators = raw.type?.ai_generators ?? {};
  const deepfake = typeof raw.type?.deepfake === 'number' ? raw.type.deepfake : null;

  console.log(
    `[sightengine] ◀ result in ${dt}ms: ai_generated=${aiGenerated.toFixed(3)} deepfake=${deepfake?.toFixed?.(3) ?? 'n/a'} generators=${Object.keys(generators).length}`,
  );
  const topGen = Object.entries(generators)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => (b[1] as number) - (a[1] as number))[0];
  if (topGen) {
    console.log(`[sightengine]   top generator: ${topGen[0]}=${(topGen[1] as number).toFixed(3)}`);
  }

  return {
    aiGenerated,
    generators,
    deepfake,
    requestId: raw.request?.id ?? '',
  };
}

// Human-friendly generator label used in Spanish verdicts. Keep concise.
const GENERATOR_LABELS: Record<SightengineGenerator, string> = {
  dalle: 'DALL·E',
  firefly: 'Adobe Firefly',
  flux: 'Flux',
  gan: 'GAN (StyleGAN/similar)',
  gpt: 'GPT-image',
  higgsfield: 'Higgsfield',
  ideogram: 'Ideogram',
  kling: 'Kling',
  imagen: 'Google Imagen/Gemini',
  midjourney: 'MidJourney',
  qwen: 'Qwen',
  recraft: 'Recraft',
  reve: 'Reve',
  seedream: 'Seedream',
  stable_diffusion: 'Stable Diffusion',
  wan: 'Wan',
  z_image: 'Z-Image',
  other: 'modelo no identificado',
};

// Returns the most-likely generator label only when Sightengine is confident
// (top score >= 0.7 and clearly ahead of the runner-up). Returns null otherwise.
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
