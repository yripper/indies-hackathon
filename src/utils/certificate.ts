/**
 * High-level certificate helper.
 *
 * Generates a PNG authenticity certificate when the verdict is 'real'.
 * Returns null for fakes or when generation fails.
 */
import { createHash } from 'node:crypto';
import { generateCertificate } from './generate-certificate.js';

export type CertificateParams = {
  mediaType: 'audio' | 'image' | 'video';
  /** Raw media buffer — SHA-256 is derived here. */
  mediaBuffer: Buffer;
  /** Confidence score returned by the detection service (0–1). */
  confidence: number;
  /** Verdict string from detection service (e.g. 'real', 'REAL', 'fake'). */
  verdict: string;
};

/**
 * Returns a PNG Buffer if the media is deemed real, otherwise null.
 */
export async function maybeBuildCertificate(params: CertificateParams): Promise<Buffer | null> {
  if (params.verdict.toLowerCase() !== 'real') return null;

  const fileHash = createHash('sha256').update(params.mediaBuffer).digest('hex');
  const timestamp = new Date().toISOString();

  return generateCertificate({
    mediaType: params.mediaType,
    fileHash,
    confidence: params.confidence,
    timestamp,
  });
}
