import type { Database } from '../connection';
import { imageAnalyses } from '../schema';

export type ImageAnalysis = typeof imageAnalyses.$inferSelect;

export type CreateImageAnalysisInput = {
  conversationId: string;
  agentRunId?: string;
  bytes: number;
  mimetype: string;
  source: 'direct' | 'quoted';
  fromName?: string;
  detector: string;
  tier: 'real' | 'uncertain' | 'fake';
  score: number;
  rawStatus: string;
  modelScores?: Array<{ name: string; status: string; score: number | null }>;
  secondaryDetector?: {
    provider: 'sightengine';
    aiGenerated: number;
    deepfake: number | null;
    generators: Record<string, number>;
    requestId: string;
    error?: string;
  } | null;
  latencyMs: number;
};

export const imageAnalysesRepo = {
  async insert(db: Database, input: CreateImageAnalysisInput): Promise<ImageAnalysis> {
    const [row] = await db
      .insert(imageAnalyses)
      .values({
        conversationId: input.conversationId,
        agentRunId: input.agentRunId,
        bytes: input.bytes,
        mimetype: input.mimetype,
        source: input.source,
        fromName: input.fromName,
        detector: input.detector,
        tier: input.tier,
        score: input.score,
        rawStatus: input.rawStatus,
        modelScores: input.modelScores ?? null,
        secondaryDetector: input.secondaryDetector ?? null,
        latencyMs: input.latencyMs,
      })
      .returning();
    return row;
  },
};
