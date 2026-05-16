/**
 * Thin client over HuggingFace Inference for image classification.
 *
 * We use the official `@huggingface/inference` SDK rather than calling the
 * legacy `api-inference.huggingface.co/models/<id>` endpoint directly.
 * That legacy URL began returning `404 Not Found: Cannot POST` in early
 * 2025 when HF migrated to the Inference Providers router
 * (`router.huggingface.co`). The SDK abstracts the new routing and will
 * survive further URL changes.
 */

import { imageClassification, type ImageClassificationOutput } from '@huggingface/inference';

export interface HfClassification {
  label: string;
  score: number;
}

export interface ClassifyImageOptions {
  token?: string;
  /**
   * MIME type for the image payload. Required so the SDK can set the right
   * Content-Type header — without it the new HF router replies "No content
   * type provided and no default one configured." Defaults to image/jpeg.
   */
  mimeType?: string;
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
  const token = opts.token ?? process.env.HF_API_TOKEN ?? '';

  if (!token) {
    throw new HfInferenceError(
      'HF_API_TOKEN is not set. Get a free token at https://huggingface.co/settings/tokens.',
    );
  }

  // The SDK accepts Blob | ArrayBuffer for image data, but the new HF router
  // requires an explicit Content-Type header. A bare ArrayBuffer carries no
  // type and the SDK errors out with "No content type provided and no
  // default one configured." Wrapping the buffer in a Blob with the right
  // mime fixes it.
  const mimeType = opts.mimeType ?? 'image/jpeg';
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });

  let result: ImageClassificationOutput;
  try {
    result = await imageClassification({
      accessToken: token,
      model: modelId,
      data: blob,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { httpResponse?: { status?: number }; status?: number }).status
      ?? (err as { httpResponse?: { status?: number } }).httpResponse?.status;
    throw new HfInferenceError(`HF Inference ${modelId}: ${msg}`, status);
  }

  if (!Array.isArray(result)) {
    throw new HfInferenceError(
      `HF Inference ${modelId} returned unexpected shape (expected array of {label,score}).`,
    );
  }

  return result
    .filter(
      (item): item is HfClassification =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { label?: unknown }).label === 'string' &&
        typeof (item as { score?: unknown }).score === 'number',
    )
    .map(({ label, score }) => ({ label, score }));
}
