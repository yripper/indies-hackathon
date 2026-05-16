import { tool } from '@langchain/core/tools';
// Zod v3 compat: see echo.ts for the rationale.
import { z } from 'zod/v3';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { exiftool, ExifDateTime } from 'exiftool-vendored';
import { fetchImageBuffer } from './lib/fetch-image-buffer';

const AI_SOFTWARE_PATTERNS = /stable diffusion|midjourney|dall[-·]?e|flux|firefly|invokeai|comfyui/i;
const EDITOR_PATTERNS = /photoshop|gimp|affinity|lightroom/i;

function fmtDate(v: unknown): string | null {
  if (v instanceof ExifDateTime) {
    try {
      return v.toISOString();
    } catch {
      return v.rawValue ?? null;
    }
  }
  return typeof v === 'string' ? v : null;
}

function interpret(tags: Record<string, unknown>): string {
  const software = String(tags.Software ?? '');
  const make = tags.Make ?? null;
  const model = tags.Model ?? null;
  const lens = tags.LensModel ?? null;
  const iso = tags.ISO ?? null;
  const dtOriginal = fmtDate(tags.DateTimeOriginal);
  const modifyDate = fmtDate(tags.ModifyDate);
  const tagCount = Object.keys(tags).length;

  if (AI_SOFTWARE_PATTERNS.test(software)) {
    return `Likely AI-generated (software trace: "${software}").`;
  }
  if (make && model && lens && iso != null) {
    if (
      EDITOR_PATTERNS.test(software) &&
      dtOriginal &&
      modifyDate &&
      modifyDate > dtOriginal
    ) {
      return `Possibly edited post-capture (camera fields present, but Software="${software}" with ModifyDate after DateTimeOriginal).`;
    }
    return 'Likely real camera capture (Make/Model/Lens/ISO consistent).';
  }
  if (tagCount <= 3) {
    return 'Metadata appears stripped (typical for social-media re-uploads; cannot conclude from absence).';
  }
  return 'Inconclusive — partial metadata; combine with other signals.';
}

export async function extractImageExifFromUrl(imageUrl: string): Promise<string> {
  const { buffer, mimeType } = await fetchImageBuffer(imageUrl);

  // exiftool-vendored requires a file path; write the buffer to a temp file
  // with a random name to avoid collisions across concurrent invocations.
  const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const tmpPath = path.join(os.tmpdir(), `exif-${randomBytes(8).toString('hex')}.${ext}`);
  await writeFile(tmpPath, buffer);

  try {
    const tags = (await exiftool.read(tmpPath)) as Record<string, unknown>;

    const make = tags.Make ?? '(none)';
    const model = tags.Model ?? '(none)';
    const software = tags.Software ?? '(none)';
    const dtOriginal = fmtDate(tags.DateTimeOriginal) ?? '(none)';
    const gps =
      tags.GPSLatitude != null && tags.GPSLongitude != null
        ? `${tags.GPSLatitude}, ${tags.GPSLongitude}`
        : 'stripped';
    const lens = tags.LensModel ?? '(none)';
    const iso = tags.ISO ?? '(none)';

    return [
      `EXIF: Make=${make}, Model=${model}, Software=${software}, DateTimeOriginal=${dtOriginal}, GPS=${gps}, LensModel=${lens}, ISO=${iso}.`,
      `Heuristic: ${interpret(tags)}`,
      'Caveat: metadata is easily strippable and forgeable; treat as a soft signal alongside C2PA, perceptual hash, and ML detectors.',
    ].join(' ');
  } finally {
    await unlink(tmpPath).catch(() => {
      /* swallow cleanup errors — tmpdir is reaped by the OS anyway */
    });
  }
}

export const extractImageExifTool = tool(
  async ({ image_url }) => {
    return await extractImageExifFromUrl(image_url);
  },
  {
    name: 'extract_image_exif',
    description:
      'Extract EXIF/XMP/IPTC metadata from an image at a public URL: camera make/model, software, GPS, timestamps, lens, ISO, and AI-generation traces (e.g., Stable Diffusion or Midjourney in the Software tag). Cheap second-line check after C2PA. Returns the metadata summary plus a heuristic interpretation with an explicit caveat that metadata is easily strippable.',
    schema: z.object({
      image_url: z.string().url().describe('Public URL of the image to inspect'),
    }),
  },
);
