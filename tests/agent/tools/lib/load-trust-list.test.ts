import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadTrustList,
  matchIssuer,
  clearTrustListCache,
} from '../../../../src/agent/tools/lib/load-trust-list';

function tmpYaml(content: string): string {
  const file = path.join(os.tmpdir(), `trust-${Date.now()}-${Math.random()}.yaml`);
  writeFileSync(file, content, 'utf8');
  return file;
}

beforeEach(() => clearTrustListCache());

describe('loadTrustList', () => {
  it('parses a valid trust list', () => {
    const file = tmpYaml(`
trusted_issuers:
  - { o: "Adobe Inc", category: "editor" }
  - { o: "Sony Group Corporation", category: "camera" }
`);
    const list = loadTrustList(file);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ o: 'Adobe Inc', category: 'editor' });
    unlinkSync(file);
  });

  it('rejects entries with invalid category', () => {
    const file = tmpYaml(`
trusted_issuers:
  - { o: "Bogus Corp", category: "spaceship" }
`);
    expect(() => loadTrustList(file)).toThrow(/Invalid C2PA trust list/);
    unlinkSync(file);
  });

  it('caches per-path so repeated reads are cheap', () => {
    const file = tmpYaml(`
trusted_issuers:
  - { o: "OpenAI", category: "ai_generator" }
`);
    const a = loadTrustList(file);
    const b = loadTrustList(file);
    expect(a).toBe(b);
    unlinkSync(file);
  });
});

describe('matchIssuer', () => {
  const list = [
    { o: 'Sony Group Corporation', category: 'camera' as const },
    { o: 'Sony Corporation', category: 'camera' as const },
    { o: 'OpenAI', category: 'ai_generator' as const },
  ];

  it('matches case-insensitive substring', () => {
    expect(matchIssuer('CN=foo, O=OpenAI, Inc.', list)?.o).toBe('OpenAI');
  });

  it('prefers the longest match when multiple are present', () => {
    expect(matchIssuer('O=Sony Group Corporation, CN=Camera A1', list)?.o).toBe(
      'Sony Group Corporation',
    );
  });

  it('returns null when nothing matches', () => {
    expect(matchIssuer('O=Unknown Test Cert', list)).toBeNull();
  });

  it('returns null for null/undefined issuer string', () => {
    expect(matchIssuer(null, list)).toBeNull();
    expect(matchIssuer(undefined, list)).toBeNull();
  });
});
