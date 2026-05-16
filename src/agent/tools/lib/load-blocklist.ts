import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

const BlocklistEntrySchema = z.object({
  hash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected 64-char hex string'),
  algo: z.literal('pdq'),
  source: z.string().min(1),
  added_at: z.string().min(1),
  case_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BlocklistEntry = z.infer<typeof BlocklistEntrySchema>;

const cache = new Map<string, BlocklistEntry[]>();

export function loadBlocklist(path: string): BlocklistEntry[] {
  const cached = cache.get(path);
  if (cached) return cached;

  if (!existsSync(path)) {
    cache.set(path, []);
    return [];
  }

  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const entries: BlocklistEntry[] = [];
  lines.forEach((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Blocklist line ${idx + 1} is not valid JSON: ${(err as Error).message}`);
    }
    const result = BlocklistEntrySchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Blocklist line ${idx + 1} failed schema: ${JSON.stringify(result.error.format())}`,
      );
    }
    entries.push(result.data);
  });

  cache.set(path, entries);
  return entries;
}

export function clearBlocklistCache(): void {
  cache.clear();
}

/**
 * Hamming distance between two equally-sized hex strings, in bits.
 * Used to compare PDQ hashes (64 hex chars = 256 bits).
 */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`Hash length mismatch: ${a.length} vs ${b.length}`);
  }
  let bits = 0;
  for (let i = 0; i < a.length; i += 2) {
    const byteA = parseInt(a.slice(i, i + 2), 16);
    const byteB = parseInt(b.slice(i, i + 2), 16);
    if (Number.isNaN(byteA) || Number.isNaN(byteB)) {
      throw new Error(`Invalid hex byte at offset ${i}`);
    }
    let diff = byteA ^ byteB;
    while (diff) {
      bits += diff & 1;
      diff >>>= 1;
    }
  }
  return bits;
}

export interface BlocklistMatch {
  entry: BlocklistEntry;
  distance: number;
}

export function findMatch(
  hash: string,
  entries: BlocklistEntry[],
  thresholdBits: number,
): BlocklistMatch | null {
  let best: BlocklistMatch | null = null;
  for (const entry of entries) {
    const d = hammingDistanceHex(hash, entry.hash);
    if (d <= thresholdBits && (best === null || d < best.distance)) {
      best = { entry, distance: d };
    }
  }
  return best;
}
