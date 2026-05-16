import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadAgentConfig } from '../../src/config/agent-config';

function tmpFile(content: string): string {
  const file = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.random()}.yaml`);
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('loadAgentConfig', () => {
  it('parses a valid YAML config', () => {
    const file = tmpFile(`
agent:
  name: "x"
  system_prompt: "You are X"
provider:
  name: "openai"
  model: "gpt-4o-mini"
  temperature: 0.7
  max_tokens: 512
tools:
  enabled: ["echo"]
limits:
  max_tool_iterations: 3
  history_window: 20
  per_message_timeout_ms: 30000
`);
    const cfg = loadAgentConfig(file);
    expect(cfg.agent.name).toBe('x');
    expect(cfg.provider.name).toBe('openai');
    expect(cfg.provider.temperature).toBe(0.7);
    expect(cfg.tools.enabled).toEqual(['echo']);
    expect(cfg.limits.max_tool_iterations).toBe(3);
    unlinkSync(file);
  });

  it('applies defaults for missing optional fields', () => {
    const file = tmpFile(`
agent:
  name: "x"
  system_prompt: "P"
provider:
  name: "anthropic"
  model: "claude-sonnet-4-6"
tools:
  enabled: []
limits: {}
`);
    const cfg = loadAgentConfig(file);
    expect(cfg.provider.temperature).toBe(0.3);
    expect(cfg.limits.max_tool_iterations).toBe(5);
    expect(cfg.limits.history_window).toBe(30);
    unlinkSync(file);
  });

  it('throws on missing system_prompt', () => {
    const file = tmpFile(`
agent:
  name: "x"
provider:
  name: "anthropic"
  model: "claude-sonnet-4-6"
tools:
  enabled: []
limits: {}
`);
    expect(() => loadAgentConfig(file)).toThrow();
    unlinkSync(file);
  });

  it('throws on unknown provider', () => {
    const file = tmpFile(`
agent:
  name: "x"
  system_prompt: "P"
provider:
  name: "fake"
  model: "x"
tools:
  enabled: []
limits: {}
`);
    expect(() => loadAgentConfig(file)).toThrow();
    unlinkSync(file);
  });

  it('throws when the YAML file does not exist', () => {
    expect(() => loadAgentConfig('/nope/missing.yaml')).toThrow();
  });
});
