import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string = env.DATABASE_URL): {
  db: Database;
  client: ReturnType<typeof postgres>;
} {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

// Default singleton for app runtime. Tests should create their own with createDb().
export const { db, client: pgClient } = createDb();
