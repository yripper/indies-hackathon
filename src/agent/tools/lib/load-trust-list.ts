import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const TrustedIssuerSchema = z.object({
  o: z.string().min(1),
  category: z.enum(['ai_generator', 'camera', 'editor', 'platform', 'publisher']),
});

const TrustListSchema = z.object({
  trusted_issuers: z.array(TrustedIssuerSchema),
});

export type TrustedIssuer = z.infer<typeof TrustedIssuerSchema>;

const cache = new Map<string, TrustedIssuer[]>();

export function loadTrustList(path: string): TrustedIssuer[] {
  const cached = cache.get(path);
  if (cached) return cached;
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw);
  const result = TrustListSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid C2PA trust list at ${path}: ${JSON.stringify(result.error.format())}`);
  }
  cache.set(path, result.data.trusted_issuers);
  return result.data.trusted_issuers;
}

export function clearTrustListCache(): void {
  cache.clear();
}

/**
 * Case-insensitive substring match against the issuer's organization name.
 * c2pa-node returns the signature's issuer as a free-form human-readable
 * string (typically containing the cert's O field plus CN). We match by
 * presence of any trusted org name within it, longest entries first so that
 * "Sony Group Corporation" wins over a shorter "Sony" prefix.
 */
export function matchIssuer(
  issuerStr: string | null | undefined,
  list: TrustedIssuer[],
): TrustedIssuer | null {
  if (!issuerStr) return null;
  const haystack = issuerStr.toLowerCase();
  const ordered = [...list].sort((a, b) => b.o.length - a.o.length);
  for (const entry of ordered) {
    if (haystack.includes(entry.o.toLowerCase())) return entry;
  }
  return null;
}
