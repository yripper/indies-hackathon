import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerPhone: text('customer_phone').notNull().unique(),
    customerName: text('customer_name'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('conversations_status_idx').on(table.status)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolName: text('tool_name'),
    toolCallId: text('tool_call_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('messages_conversation_idx').on(table.conversationId, table.createdAt)],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    triggerMessageId: uuid('trigger_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    agentName: text('agent_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    iterations: integer('iterations').notNull().default(0),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [index('agent_runs_conversation_idx').on(table.conversationId, table.startedAt)],
);

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    arguments: jsonb('arguments').notNull(),
    result: jsonb('result'),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    succeeded: boolean('succeeded').notNull().default(false),
    invokedAt: timestamp('invoked_at').defaultNow().notNull(),
  },
  (table) => [index('tool_calls_run_idx').on(table.agentRunId, table.invokedAt)],
);
