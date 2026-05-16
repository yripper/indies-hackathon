import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@huggingface/inference', () => ({
  imageClassification: vi.fn(),
}));

import { classifyImage, HfInferenceError } from '../../../../src/agent/tools/lib/hf-inference';
import { imageClassification } from '@huggingface/inference';

const sdkMock = imageClassification as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  sdkMock.mockReset();
});

describe('classifyImage', () => {
  it('returns the SDK output unchanged for well-formed classifications', async () => {
    sdkMock.mockResolvedValueOnce([
      { label: 'Fake', score: 0.91 },
      { label: 'Real', score: 0.09 },
    ]);
    const out = await classifyImage('any/model', Buffer.from('x'), { token: 'hf_test' });
    expect(out).toEqual([
      { label: 'Fake', score: 0.91 },
      { label: 'Real', score: 0.09 },
    ]);
  });

  it('hands the SDK a tight ArrayBuffer derived from the input Buffer', async () => {
    sdkMock.mockResolvedValueOnce([{ label: 'x', score: 1 }]);
    const buf = Buffer.from([1, 2, 3, 4]);
    await classifyImage('any/model', buf, { token: 't' });
    expect(sdkMock).toHaveBeenCalledOnce();
    const args = sdkMock.mock.calls[0][0] as { data: ArrayBuffer; model: string; accessToken: string };
    expect(args.model).toBe('any/model');
    expect(args.accessToken).toBe('t');
    expect(args.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(args.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('throws when HF_API_TOKEN is missing', async () => {
    const original = process.env.HF_API_TOKEN;
    delete process.env.HF_API_TOKEN;
    try {
      await expect(classifyImage('m', Buffer.from('x'))).rejects.toThrow(/HF_API_TOKEN is not set/);
    } finally {
      if (original !== undefined) process.env.HF_API_TOKEN = original;
    }
  });

  it('wraps SDK errors in HfInferenceError, preserving status when present', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    sdkMock.mockRejectedValueOnce(err);
    await expect(
      classifyImage('m', Buffer.from('x'), { token: 't' }),
    ).rejects.toMatchObject({ name: 'HfInferenceError', status: 404 });
  });

  it('throws when SDK returns an unexpected shape', async () => {
    sdkMock.mockResolvedValueOnce({ not: 'an array' } as never);
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
