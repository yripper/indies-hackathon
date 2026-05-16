import { tool } from '@langchain/core/tools';
// Zod v3 compat: see echo.ts.
import { z } from 'zod/v3';
import sharp from 'sharp';
import { fetchImageBuffer } from './lib/fetch-image-buffer';
import { classifyImage, HfInferenceError } from './lib/hf-inference';

const DEFAULT_MODEL = 'prithivMLmods/deepfake-detector-model-v1';

const FAKE_LABELS = new Set(['fake', 'deepfake', 'manipulated', 'synthetic']);

async function preprocessForModel(buffer: Buffer): Promise<Buffer> {
  return await sharp(buffer)
    .removeAlpha()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: false })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function detectFaceManipulationFromUrl(imageUrl: string): Promise<string> {
  const modelId = process.env.FACE_DETECTOR_MODEL ?? DEFAULT_MODEL;

  const { buffer } = await fetchImageBuffer(imageUrl);
  const preprocessed = await preprocessForModel(buffer);

  let results;
  try {
    results = await classifyImage(modelId, preprocessed, { mimeType: 'image/jpeg' });
  } catch (err) {
    if (err instanceof HfInferenceError && err.status === 503) {
      return `Face manipulation detector temporarily unavailable (HF cold-start, status 503 after one retry). Other signals still apply.`;
    }
    throw err;
  }

  if (results.length === 0) {
    return `Face manipulation detector (${modelId}): no classifications returned.`;
  }

  const top = [...results].sort((a, b) => b.score - a.score)[0];
  const fakeEntry = results.find((r) => FAKE_LABELS.has(r.label.toLowerCase()));
  const fakeScore = fakeEntry?.score;

  const scoreStr =
    fakeScore != null
      ? `fake_score=${fakeScore.toFixed(3)}`
      : `top_score=${top.score.toFixed(3)}`;

  return [
    `Face manipulation detector (${modelId}): top_label="${top.label}" (${top.score.toFixed(3)}), ${scoreStr}.`,
    `Threshold guidance: a fake-side score > 0.7 suggests face manipulation or deepfake.`,
    `Caveat: V0 has no internal face-detection pre-filter; this tool runs on whatever image you give it. If the image contains no faces, the result is unreliable — only invoke this tool when faces are likely present. Combine with C2PA, EXIF, diffusion detector, and PDQ.`,
  ].join(' ');
}

export const detectFaceManipulationTool = tool(
  async ({ image_url }) => {
    return await detectFaceManipulationFromUrl(image_url);
  },
  {
    name: 'detect_face_manipulation',
    description:
      "Detect face-swap or GAN-based facial manipulation in an image at a public URL (deepfakes of real people, identity suplantación, fabricated compromising photos of public figures). Only invoke when the image contains faces — political figures, celebrities, suspected impersonation, claims of intimate content. Returns the fake-side score with an explicit caveat that V0 has no face-detection pre-filter, so the LLM must judge applicability.",
    schema: z.object({
      image_url: z.string().url().describe('Public URL of the image to classify'),
    }),
  },
);
