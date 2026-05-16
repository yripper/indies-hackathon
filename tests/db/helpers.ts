import { createDb } from '../../src/db/connection';
import { sql } from 'drizzle-orm';

export function makeTestDb() {
  const url =
    process.env.DATABASE_URL ?? 'postgres://indies:indies@localhost:5432/indies_test';
  return createDb(url);
}

export async function cleanDb(db: ReturnType<typeof makeTestDb>['db']): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE tool_calls, agent_runs, messages, conversations RESTART IDENTITY CASCADE`);
}
