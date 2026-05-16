/**
 * Thin client over HuggingFace Serverless Inference for image classification.
 * One retry on 503 (the model can be cold-loading; HF spins it up).
 */

const DEFAULT_BASE_URL = 'https://api-inference.huggingface.co/models';
const COLD_START_DELAY_MS = 5_000;

export interface HfClassification {
  label: string;
  score: number;
}

export interface ClassifyImageOptions {
  baseUrl?: string;
  token?: string;
  contentType?: string;
  coldStartRetry?: boolean;
  /** Override only for tests; defaults to {@link COLD_START_DELAY_MS}. */
  retryDelayMs?: number;
}

export class HfInferenceError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'HfInferenceError';
  }
}

export async function classifyImage(
  modelId: string,
  buffer: Buffer,
  opts: ClassifyImageOptions = {},
): Promise<HfClassification[]> {
  const baseUrl = opts.baseUrl ?? process.env.HF_INFERENCE_BASE_URL ?? DEFAULT_BASE_URL;
  const token = opts.token ?? process.env.HF_API_TOKEN ?? '';
  const contentType = opts.contentType ?? 'image/jpeg';
  const retry = opts.coldStartRetry ?? true;

  if (!token) {
    throw new HfInferenceError(
      'HF_API_TOKEN is not set. Get a free token at https://huggingface.co/settings/tokens.',
    );
  }

  const url = `${baseUrl.replace(/\/$/, '')}/${modelId}`;

  const doPost = async (): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: buffer,
    });

  let res = await doPost();

  if (res.status === 503 && retry) {
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? COLD_START_DELAY_MS));
    res = await doPost();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HfInferenceError(
      `HF Inference ${modelId} returned ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new HfInferenceError(
      `HF Inference ${modelId} returned unexpected shape (expected array of {label,score}).`,
    );
  }

  return json
    .filter(
      (item): item is HfClassification =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { label?: unknown }).label === 'string' &&
        typeof (item as { score?: unknown }).score === 'number',
    )
    .map(({ label, score }) => ({ label, score }));
}
