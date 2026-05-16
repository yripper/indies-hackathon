import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

const echoSchema = z.object({
  text: z.string().describe('the text to echo back'),
});

// Langchain @langchain/core targets zod v3 while this project uses zod v4.
// TS6 strict overload resolution does not recognize zod v4's $ZodObject as
// satisfying the ZodObjectV3 overload, so we cast to preserve the string output
// type. The schema is still validated at call time by langchain's tool() internals.
async function echoImpl(input: unknown): Promise<string> {
  const { text } = echoSchema.parse(input);
  return text;
}

type EchoTool = StructuredToolInterface & { invoke(input: { text: string }): Promise<string> };

export const echoTool = tool(
  echoImpl as Parameters<typeof tool>[0],
  {
    name: 'echo',
    description: 'Echo back the input text verbatim. Useful for sanity-checking tool dispatch.',
    schema: echoSchema,
  },
) as unknown as EchoTool;
