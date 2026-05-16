import { describe, it, expect } from 'vitest';
import { calculatorTool } from '../../../src/agent/tools/calculator';

describe('calculatorTool', () => {
  it.each([
    ['2 + 2', '4'],
    ['10 - 7', '3'],
    ['3 * 4', '12'],
    ['20 / 4', '5'],
    ['(1 + 2) * 3', '9'],
    ['1.5 + 2.5', '4'],
  ])('evaluates %s to %s', async (expression, expected) => {
    const result = await calculatorTool.invoke({ expression });
    expect(result).toBe(expected);
  });

  it('throws on disallowed characters', async () => {
    await expect(calculatorTool.invoke({ expression: 'console.log(1)' })).rejects.toThrow();
    await expect(calculatorTool.invoke({ expression: '2 ** 3' })).rejects.toThrow();
  });

  it('throws on division by zero', async () => {
    await expect(calculatorTool.invoke({ expression: '1 / 0' })).rejects.toThrow();
  });
});
