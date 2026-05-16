import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

const isTest = process.env.NODE_ENV === 'test';
loadDotenv({ path: isTest ? '.env.test' : '.env' });

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  // Override OpenAI base URL to point ChatOpenAI at an OpenAI-compatible endpoint
  // (e.g. MiniMax: https://api.minimax.io/v1). Leave empty to use OpenAI directly.
  OPENAI_BASE_URL: z.string().optional().default(''),
  WA_SESSION_KEY: z.string().regex(HEX_64, 'WA_SESSION_KEY must be 64 hex chars (32 bytes)'),
  SESSIONS_DIR: z.string().default('./sessions'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  AGENT_CONFIG_PATH: z.string().default('./agent.config.yaml'),
  // Reality Defender API key for the image deepfake detection tool. Required
  // when agent config enables analyze_image_deepfake; harmless when unset
  // (the tool returns a Spanish error on invocation).
  REALITY_DEFENDER_API_KEY: z.string().optional().default(''),
  // Sightengine credentials for the second-opinion AI-generated image
  // detector. Free tier: 2k ops/month, 500/day, 1 req/s. When unset, the
  // image tool falls back to RD-only scoring.
  SIGHTENGINE_API_USER: z.string().optional().default(''),
  SIGHTENGINE_API_SECRET: z.string().optional().default(''),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env: Env = parsed.data;
