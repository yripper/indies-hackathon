import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyImage, HfInferenceError } from '../../../../src/agent/tools/lib/hf-inference';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyImage', () => {
  it('parses a successful classification response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse([
        { label: 'Fake', score: 0.91 },
        { label: 'Real', score: 0.09 },
      ]),
    );
    const out = await classifyImage('any/model', Buffer.from('x'), { token: 'hf_test' });
    expect(out).toEqual([
      { label: 'Fake', score: 0.91 },
      { label: 'Real', score: 0.09 },
    ]);
  });

  it('throws when HF_API_TOKEN is missing', async () => {
    delete process.env.HF_API_TOKEN;
    await expect(classifyImage('any/model', Buffer.from('x'))).rejects.toThrow(
      /HF_API_TOKEN is not set/,
    );
  });

  it('retries once on 503 cold-start, then succeeds', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'loading' }, 503));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ label: 'Real', score: 1 }]));
    const out = await classifyImage('m', Buffer.from('x'), {
      token: 't',
      retryDelayMs: 1,
    });
    expect(out).toEqual([{ label: 'Real', score: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws HfInferenceError with status when 503 persists after retry', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ error: 'loading' }, 503));
    await expect(
      classifyImage('m', Buffer.from('x'), { token: 't', retryDelayMs: 1 }),
    ).rejects.toMatchObject({ name: 'HfInferenceError', status: 503 });
  });

  it('throws on unexpected response shape', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ not: 'an array' }));
    await expect(
      classifyImage('m', Buffer.from('x'), { token: 't' }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it('exposes HfInferenceError', () => {
    const err = new HfInferenceError('boom', 500);
    expect(err.status).toBe(500);
    expect(err.name).toBe('HfInferenceError');
  });
});
