import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

// Only digits, basic operators, parens, decimal point, and whitespace are allowed.
// This rejects exponentiation (**), letters, semicolons, etc.
const ALLOWED = /^[0-9+\-*/().\s]+$/;

function buildParser(src: string) {
  let i = 0;

  function peek(): string | undefined {
    return src[i];
  }

  function consume(c: string): void {
    if (src[i] !== c) throw new Error(`Expected '${c}' at position ${i}`);
    i += 1;
  }

  function parseNumber(): number {
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i]!)) i += 1;
    if (start === i) throw new Error(`Expected number at position ${i}`);
    const n = Number(src.slice(start, i));
    if (!Number.isFinite(n)) throw new Error('Number overflow');
    return n;
  }

  // factor handles unary minus and parenthesised sub-expressions
  function parseFactor(): number {
    if (peek() === '(') {
      consume('(');
      const value = parseExpression();
      consume(')');
      return value;
    }
    if (peek() === '-') {
      consume('-');
      return -parseFactor();
    }
    return parseNumber();
  }

  // term handles * and /
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i]!;
      i += 1;
      const rhs = parseFactor();
      if (op === '/') {
        if (rhs === 0) throw new Error('Division by zero');
        value /= rhs;
      } else {
        value *= rhs;
      }
    }
    return value;
  }

  // expression handles + and -
  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = src[i]!;
      i += 1;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  return { parseExpression, remaining: () => i < src.length };
}

function evaluate(expression: string): number {
  const src = expression.replace(/\s+/g, '');
  const parser = buildParser(src);
  const result = parser.parseExpression();
  if (parser.remaining()) {
    throw new Error(`Unexpected character in expression`);
  }
  return result;
}

const calculatorSchema = z.object({
  expression: z.string().describe('e.g. "2 + 2 * 3"'),
});

// Langchain @langchain/core targets zod v3 while this project uses zod v4.
// TS6 strict overload resolution does not recognize zod v4's $ZodObject as
// satisfying the ZodObjectV3 overload, so we cast to preserve the string output
// type. The schema is still validated at call time by langchain's tool() internals.
async function calculatorImpl(input: unknown): Promise<string> {
  const { expression } = calculatorSchema.parse(input);
  if (!ALLOWED.test(expression)) {
    throw new Error(
      'Expression contains disallowed characters. Allowed: digits, + - * / ( ) and spaces.',
    );
  }
  const value = evaluate(expression);
  // Return integer strings without decimal noise; floats trimmed to at most 10 decimal places
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

type CalculatorTool = StructuredToolInterface & {
  invoke(input: { expression: string }): Promise<string>;
};

export const calculatorTool = tool(
  calculatorImpl as Parameters<typeof tool>[0],
  {
    name: 'calculator',
    description:
      'Evaluate a basic arithmetic expression with +, -, *, /, and parentheses. No exponentiation.',
    schema: calculatorSchema,
  },
) as unknown as CalculatorTool;
