import crypto from 'crypto';

export type DarkwebCampaign = {
  campaignHash: string;
  source: string;
  sourceUrl: string;
  title: string;
  content: string;
  topics: string[];
  confidence: number;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: Date | null;
};

const TOPIC_KEYWORDS = [
  'fake news', 'disinformation', 'misinformation', 'propaganda',
  'deepfake', 'manipulated video', 'hoax', 'fake account',
  ' Election', '投票', 'fraude', 'conspiracy',
];

const COUNTRY_PATTERNS: Record<string, { keywords: string[]; lat: number; lon: number }> = {
  'USA': { keywords: ['USA', 'America', 'Washington', 'Trump', 'Biden'], lat: 38.9, lon: -77.0 },
  'Mexico': { keywords: ['Mexico', 'CDMX', 'AMLO', 'Narcos'], lat: 19.4, lon: -99.1 },
  'Brazil': { keywords: ['Brasil', 'Bolsonaro', 'Lula', 'São Paulo'], lat: -23.5, lon: -46.6 },
  'Argentina': { keywords: ['Argentina', 'Buenos Aires', 'Milei', 'Kirchner'], lat: -34.6, lon: -58.4 },
  'Colombia': { keywords: ['Colombia', 'Bogotá', 'Petro', 'FARC'], lat: 4.7, lon: -74.1 },
  'Chile': { keywords: ['Chile', 'Santiago', 'Boric'], lat: -33.4, lon: -70.7 },
  'Peru': { keywords: ['Peru', 'Lima', 'Boluarte'], lat: -12.0, lon: -77.0 },
  'Spain': { keywords: ['España', 'Madrid', 'Barcelona'], lat: 40.4, lon: -3.7 },
};

function extractTopics(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const kw of TOPIC_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }
  return [...new Set(found)].slice(0, 5);
}

function detectCountry(text: string): { country: string | null; lat: number | null; lon: number | null } {
  for (const [country, data] of Object.entries(COUNTRY_PATTERNS)) {
    for (const kw of data.keywords) {
      if (text.includes(kw)) {
        return { country, lat: data.lat, lon: data.lon };
      }
    }
  }
  return { country: null, lat: null, lon: null };
}

export function parseDarkwebPost(
  source: string,
  sourceUrl: string,
  title: string,
  content: string,
  publishedAt?: Date
): DarkwebCampaign {
  const hash = crypto
    .createHash('sha256')
    .update(`${source}:${sourceUrl}:${title}`)
    .digest('hex');

  const topics = extractTopics(content);
  const geo = detectCountry(`${title} ${content}`);

  const confidence = Math.min(0.95, 0.3 + topics.length * 0.1 + (geo.country ? 0.2 : 0));

  return {
    campaignHash: hash,
    source,
    sourceUrl,
    title,
    content: content.slice(0, 500),
    topics,
    confidence,
    country: geo.country,
    latitude: geo.lat,
    longitude: geo.lon,
    publishedAt: publishedAt || null,
  };
}

export function calculateCampaignRisk(campaign: DarkwebCampaign): 'low' | 'medium' | 'high' {
  if (campaign.confidence >= 0.7 && campaign.topics.length >= 3) return 'high';
  if (campaign.confidence >= 0.5 && campaign.topics.length >= 2) return 'medium';
  return 'low';
}

export type DarkwebSource = {
  name: string;
  type: 'forum' | 'social' | 'news' | 'tor';
  checkIntervalMs: number;
};

export const DARKWEB_SOURCES: DarkwebSource[] = [
  { name: 'Reddit', type: 'social', checkIntervalMs: 300000 },
  { name: 'Telegram', type: 'social', checkIntervalMs: 120000 },
  { name: 'Twitter', type: 'social', checkIntervalMs: 60000 },
  { name: '4chan', type: 'forum', checkIntervalMs: 180000 },
  { name: 'Dark Web Forums', type: 'tor', checkIntervalMs: 600000 },
];