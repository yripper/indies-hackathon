import { tool } from '@langchain/core/tools';
// Zod v3 compat for langchain-openai tool conversion (see echo.ts).
import { z } from 'zod/v3';

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
  let offset = tzName.replace('GMT', '').trim();
  if (offset === '') offset = '+00:00';
  if (/^[+-]\d{1,2}$/.test(offset)) {
    const sign = offset[0];
    const num = offset.slice(1).padStart(2, '0');
    offset = `${sign}${num}:00`;
  } else if (/^[+-]\d{2}:\d{2}$/.test(offset)) {
    // already normalized
  } else {
    return date.toISOString();
  }
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}:${parts['second']}${offset}`;
}

export const getCurrentTimeTool = tool(
  async ({ timezone }) => {
    const tz = timezone ?? 'UTC';
    if (!isValidTimezone(tz)) {
      throw new Error(`Invalid IANA timezone: ${tz}`);
    }
    return isoWithOffset(new Date(), tz);
  },
  {
    name: 'get_current_time',
    description: 'Return the current time as an ISO-8601 string. Optional IANA timezone (default UTC).',
    schema: z.object({
      timezone: z
        .string()
        .optional()
        .describe('IANA timezone name like "America/Santiago" or "UTC". Defaults to UTC.'),
    }),
  },
);
