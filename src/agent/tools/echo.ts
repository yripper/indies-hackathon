import { tool } from '@langchain/core/tools';
// Zod v3 compat: @langchain/openai 0.3 routes tool schemas through openai SDK's
// bundled Zod-3-only zod-to-json-schema. Zod v3 syntax via this subpath works
// transparently; the rest of the project stays on Zod 4.
import { z } from 'zod/v3';

export const echoTool = tool(
  async ({ text }) => text,
  {
    name: 'echo',
    description: 'Echo back the input text verbatim. Useful for sanity-checking tool dispatch.',
    schema: z.object({
      text: z.string().describe('the text to echo back'),
    }),
  },
);
