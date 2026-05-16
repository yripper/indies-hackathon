import { tool } from '@langchain/core/tools';
// Zod v3 compat: see echo.ts.
import { z } from 'zod/v3';
import { z as zod4 } from 'zod';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { fetchImageBuffer } from './lib/fetch-image-buffer';

// pdq-wasm's ESM build crashes in Node with "WASM module not available"
// because its `getWasmFactory()` uses `require()` which is undefined under
// ESM. Force the CJS entry via createRequire so the bundled WASM loads.
const requireCJS = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
// createRequire honors the package's "require" export condition, which maps
// to the CJS build that uses native require() to load the bundled WASM.
const { PDQ } = requireCJS('pdq-wasm') as typeof import('pdq-wasm');
import { loadBlocklist, findMatch } from './lib/load-blocklist';

const ConfigSchema = zod4.object({
  blocklist_path: zod4.string().min(1).default('./config/blocklist.jsonl'),
  hamming_threshold: zod4.number().int().min(0).max(256).default(8),
});
export type ComputePerceptualHashConfig = zod4.infer<typeof ConfigSchema>;

let pdqReady: Promise<void> | null = null;
function ensurePdqInit(): Promise<void> {
  if (!pdqReady) pdqReady = PDQ.init();
  return pdqReady;
}

export async function computePdqFromImageBuffer(buffer: Buffer): Promise<{
  hash: string;
  quality: number;
}> {
  await ensurePdqInit();

  // PDQ requires raw RGB pixels (channels=3). Use sharp to decode any
  // supported format, strip alpha, and emit raw bytes plus dimensions.
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected 3-channel RGB after sharp decode, got ${info.channels}`);
  }

  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const result = PDQ.hash({
    data: pixels,
    width: info.width,
    height: info.height,
    channels: 3,
  });

  return { hash: PDQ.toHex(result.hash), quality: result.quality };
}

export function createComputePerceptualHashTool(rawConfig?: unknown) {
  const config = ConfigSchema.parse(rawConfig ?? {});

  return tool(
    async ({ image_url }) => {
      const { buffer } = await fetchImageBuffer(image_url);
      const { hash, quality } = await computePdqFromImageBuffer(buffer);
      const entries = loadBlocklist(config.blocklist_path);
      const match = findMatch(hash, entries, config.hamming_threshold);

      if (match) {
        const { entry, distance } = match;
        const caseId = entry.case_id ? `case_id=${entry.case_id}, ` : '';
        return `Perceptual hash (PDQ): ${hash} (quality=${quality}). MATCH in blocklist (source=${entry.source}, ${caseId}added=${entry.added_at}, hamming_distance=${distance} bits). This image has been seen before.`;
      }
      return `Perceptual hash (PDQ): ${hash} (quality=${quality}). No match in blocklist (checked ${entries.length} entries, threshold=${config.hamming_threshold} bits). Note: absence of match means we haven't seen this image; it does not imply legitimacy.`;
    },
    {
      name: 'compute_perceptual_hash',
      description:
        "Compute a PDQ perceptual hash of an image at a public URL and check it against a local blocklist of known-bad or previously-analyzed hashes. Privacy-preserving: never sends pixels to any external service. Use as the FIRST step on any suspicious image — it's instant, local, and lets you skip costly checks when the image is already known. Hamming distance ≤ 8 bits (over 256) is considered a match by default.",
      schema: z.object({
        image_url: z.string().url().describe('Public URL of the image to hash'),
      }),
    },
  );
}
