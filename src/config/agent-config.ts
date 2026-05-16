import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const AgentConfigSchema = z.object({
  agent: z.object({
    name: z.string().min(1),
    system_prompt: z.string().min(1),
  }),
  provider: z.object({
    name: z.enum(['anthropic', 'openai']),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.3),
    max_tokens: z.number().int().positive().default(1024),
  }),
  tools: z.object({
    enabled: z.array(z.string()).default([]),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  limits: z
    .object({
      max_tool_iterations: z.number().int().min(1).default(5),
      history_window: z.number().int().min(1).default(30),
      per_message_timeout_ms: z.number().int().positive().default(60000),
    })
    .default(() => ({
      max_tool_iterations: 5,
      history_window: 30,
      per_message_timeout_ms: 60000,
    })),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function loadAgentConfig(filePath: string): AgentConfig {
  // readFileSync throws ENOENT if the file is missing — let it propagate
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw);
  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const msg = typeof (z as { prettifyError?: (e: unknown) => string }).prettifyError === 'function'
      ? (z as { prettifyError: (e: unknown) => string }).prettifyError(result.error)
      : JSON.stringify(result.error.format(), null, 2);
    throw new Error(`Invalid agent config at ${filePath}: ${msg}`);
  }
  return result.data;
}
