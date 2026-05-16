import { describe, it, expect } from 'vitest';
import { getCurrentTimeTool } from '../../../src/agent/tools/get-current-time';

describe('getCurrentTimeTool', () => {
  it('returns an ISO-8601 string for default UTC', async () => {
    const result = await getCurrentTimeTool.invoke({});
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result).toContain('Z'); // UTC marker
  });

  it('accepts an IANA timezone', async () => {
    const result = await getCurrentTimeTool.invoke({ timezone: 'America/Santiago' });
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Santiago is UTC-3 or -4 — offset should be non-Z
    expect(result.endsWith('Z')).toBe(false);
  });

  it('throws on an invalid IANA timezone', async () => {
    await expect(getCurrentTimeTool.invoke({ timezone: 'Not/AZone' })).rejects.toThrow();
  });
});
