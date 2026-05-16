import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isoWithOffset(date: Date, timezone: string): string {
  if (timezone === 'UTC' || timezone === 'Etc/UTC') {
    return date.toISOString();
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const tzName = parts['timeZoneName'] ?? 'GMT';
  // tzName looks like "GMT-3" or "GMT-04:30" or "GMT"
  let offset = tzName.replace('GMT', '').trim();
  if (offset === '') offset = '+00:00';
  // Normalize "+3" → "+03:00", "-04:30" → "-04:30"
  if (/^[+-]\d{1,2}$/.test(offset)) {
    const sign = offset[0];
    const num = offset.slice(1).padStart(2, '0');
    offset = `${sign}${num}:00`;
  } else if (/^[+-]\d{2}:\d{2}$/.test(offset)) {
    // already normalized
  } else {
    // unexpected — fall back to UTC ISO
    return date.toISOString();
  }
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}:${parts['second']}${offset}`;
}

const getCurrentTimeSchema = z.object({
  timezone: z
    .string()
    .optional()
    .describe('IANA timezone name like "America/Santiago" or "UTC". Defaults to UTC.'),
});

// Langchain @langchain/core targets zod v3 while this project uses zod v4.
// TS6 strict overload resolution does not recognize zod v4's $ZodObject as
// satisfying the ZodObjectV3 overload, so we cast to preserve the string output
// type. The schema is still validated at call time by langchain's tool() internals.
async function getCurrentTimeImpl(input: unknown): Promise<string> {
  const { timezone } = getCurrentTimeSchema.parse(input);
  const tz = timezone ?? 'UTC';
  if (!isValidTimezone(tz)) {
    throw new Error(`Invalid IANA timezone: ${tz}`);
  }
  return isoWithOffset(new Date(), tz);
}

type GetCurrentTimeTool = StructuredToolInterface & {
  invoke(input: { timezone?: string }): Promise<string>;
};

export const getCurrentTimeTool = tool(
  getCurrentTimeImpl as Parameters<typeof tool>[0],
  {
    name: 'get_current_time',
    description: 'Return the current time as an ISO-8601 string. Optional IANA timezone (default UTC).',
    schema: getCurrentTimeSchema,
  },
) as unknown as GetCurrentTimeTool;
