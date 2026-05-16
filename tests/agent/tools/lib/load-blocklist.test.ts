import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadBlocklist,
  hammingDistanceHex,
  findMatch,
  clearBlocklistCache,
} from '../../../../src/agent/tools/lib/load-blocklist';

function tmpJsonl(lines: object[]): string {
  const file = path.join(os.tmpdir(), `bl-${Date.now()}-${Math.random()}.jsonl`);
  writeFileSync(file, lines.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
  return file;
}

beforeEach(() => clearBlocklistCache());

describe('loadBlocklist', () => {
  it('returns an empty list when the file does not exist', () => {
    expect(loadBlocklist('/nonexistent/path/blocklist.jsonl')).toEqual([]);
  });

  it('parses valid JSONL entries', () => {
    const file = tmpJsonl([
      {
        hash: 'a'.repeat(64),
        algo: 'pdq',
        source: 'victim-report',
        added_at: '2026-05-16',
        case_id: 'case_abc',
        metadata: { note: 'hi' },
      },
    ]);
    const list = loadBlocklist(file);
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('victim-report');
    unlinkSync(file);
  });

  it('rejects entries with non-hex hashes', () => {
    const file = tmpJsonl([
      { hash: 'not-hex', algo: 'pdq', source: 's', added_at: '2026-01-01' },
    ]);
    expect(() => loadBlocklist(file)).toThrow(/failed schema/);
    unlinkSync(file);
  });

  it('rejects entries with non-pdq algo', () => {
    const file = tmpJsonl([
      { hash: '0'.repeat(64), algo: 'phash', source: 's', added_at: '2026-01-01' },
    ]);
    expect(() => loadBlocklist(file)).toThrow(/failed schema/);
    unlinkSync(file);
  });

  it('throws on malformed JSON lines with the offending line number', () => {
    const file = path.join(os.tmpdir(), `bl-bad-${Date.now()}.jsonl`);
    writeFileSync(file, '{not json}\n', 'utf8');
    expect(() => loadBlocklist(file)).toThrow(/line 1/);
    unlinkSync(file);
  });
});

describe('hammingDistanceHex', () => {
  it('returns 0 for identical hashes', () => {
    const h = 'ab'.repeat(32);
    expect(hammingDistanceHex(h, h)).toBe(0);
  });

  it('counts differing bits across whole hash', () => {
    expect(hammingDistanceHex('00', 'ff')).toBe(8);
    expect(hammingDistanceHex('0000', 'ffff')).toBe(16);
  });

  it('rejects mismatched lengths', () => {
    expect(() => hammingDistanceHex('00', '0000')).toThrow(/length mismatch/);
  });
});

describe('findMatch', () => {
  const base = '0'.repeat(64);
  const entries = [
    { hash: base, algo: 'pdq' as const, source: 's1', added_at: '2026-01-01' },
    // 4 bits different from base
    { hash: '0f' + '0'.repeat(62), algo: 'pdq' as const, source: 's2', added_at: '2026-01-02' },
  ];

  it('finds an exact match at distance 0', () => {
    const m = findMatch(base, entries, 8);
    expect(m?.distance).toBe(0);
    expect(m?.entry.source).toBe('s1');
  });

  it('finds the closest entry when multiple are within threshold', () => {
    // a hash close to s2 (1 bit different from s2)
    const candidate = '0e' + '0'.repeat(62);
    const m = findMatch(candidate, entries, 8);
    expect(m?.entry.source).toBe('s2');
  });

  it('returns null when nothing is within threshold', () => {
    const farAway = 'f'.repeat(64);
    expect(findMatch(farAway, entries, 8)).toBeNull();
  });
});
