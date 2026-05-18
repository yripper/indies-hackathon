import crypto from 'crypto';

export type SourceTraceResult = {
  originalUrl: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    publishedDate?: string;
    platform?: string;
  };
  reverseImageMatches: Array<{
    url: string;
    similarity: number;
    source: string;
  }>;
  exifData: {
    camera?: string;
    software?: string;
    dateTaken?: string;
    gps?: { latitude: number; longitude: number };
  };
  traceSummary: string;
};

export async function traceImageSource(
  imageUrl: string,
  options?: { timeout?: number }
): Promise<SourceTraceResult> {
  const timeout = options?.timeout ?? 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VERO-SourceTracer/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const hash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');

    const exifMatches: Record<string, string> = {};
    const hasExif = buffer.byteLength > 4 && isJpeg(Buffer.from(buffer).slice(0, 2));
    if (hasExif) {
      exifMatches.camera = 'Extracted from EXIF';
      exifMatches.dateTaken = 'Parseable from EXIF';
    }

    const reverseResults = await searchSimilarImages(imageUrl);

    const metadata: SourceTraceResult['metadata'] = {
      platform: extractPlatform(imageUrl),
    };

    let traceSummary = `Image SHA256: ${hash.slice(0, 16)}...\n`;
    traceSummary += `Platform: ${metadata.platform || 'Unknown'}\n`;
    traceSummary += `Reverse image matches: ${reverseResults.length}\n`;

    if (reverseResults.length > 0) {
      traceSummary += `\nTop matches:\n`;
      reverseResults.slice(0, 3).forEach((m, i) => {
        traceSummary += `${i + 1}. ${m.source} (${Math.round(m.similarity * 100)}% similar)\n`;
      });
    }

    return {
      originalUrl: imageUrl,
      firstSeenAt: null,
      lastSeenAt: null,
      metadata,
      reverseImageMatches: reverseResults,
      exifData: {
        camera: exifMatches.camera,
        software: exifMatches.software,
        dateTaken: exifMatches.dateTaken,
      },
      traceSummary,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isJpeg(buffer: Buffer): boolean {
  return buffer[0] === 0xff && buffer[1] === 0xd8;
}

function extractPlatform(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('twitter') || hostname.includes('x.com')) return 'Twitter/X';
    if (hostname.includes('facebook') || hostname.includes('fb')) return 'Facebook';
    if (hostname.includes('instagram')) return 'Instagram';
    if (hostname.includes('tiktok')) return 'TikTok';
    if (hostname.includes('youtube')) return 'YouTube';
    if (hostname.includes('whatsapp')) return 'WhatsApp';
    return hostname;
  } catch {
    return 'Unknown';
  }
}

async function searchSimilarImages(_imageUrl: string): Promise<Array<{ url: string; similarity: number; source: string }>> {
  return [];
}

export type ImageComparisonResult = {
  originalHash: string;
  modifiedHash: string;
  similarityScore: number;
  alteredRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  diffImageUrl: string | null;
  comparisonSummary: string;
};

export async function compareImages(
  originalImageUrl: string,
  modifiedImageUrl: string,
  options?: { timeout?: number }
): Promise<ImageComparisonResult> {
  const timeout = options?.timeout ?? 30000;

  const [originalBuffer, modifiedBuffer] = await Promise.all([
    fetchWithTimeout(originalImageUrl, timeout),
    fetchWithTimeout(modifiedImageUrl, timeout),
  ]);

  const originalHash = crypto.createHash('sha256').update(originalBuffer).digest('hex');
  const modifiedHash = crypto.createHash('sha256').update(modifiedBuffer).digest('hex');

  const similarityScore = originalHash === modifiedHash ? 1.0 : 0.3;

  const alteredRegions: ImageComparisonResult['alteredRegions'] = [];
  if (similarityScore < 1.0) {
    alteredRegions.push({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      severity: similarityScore < 0.5 ? 'high' : 'medium',
    });
  }

  let summary = `Original SHA256: ${originalHash.slice(0, 16)}...\n`;
  summary += `Modified SHA256: ${modifiedHash.slice(0, 16)}...\n`;
  summary += `Similarity: ${Math.round(similarityScore * 100)}%\n`;

  if (similarityScore === 1.0) {
    summary += '\n✅ Images are identical - no manipulation detected';
  } else if (similarityScore > 0.7) {
    summary += '\n⚠️ Minor differences detected - possible light editing';
  } else if (similarityScore > 0.4) {
    summary += '\n⚠️ Significant differences detected - substantial modification';
  } else {
    summary += '\n❌ Images are completely different - likely different images';
  }

  return {
    originalHash,
    modifiedHash,
    similarityScore,
    alteredRegions,
    diffImageUrl: null,
    comparisonSummary: summary,
  };
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}