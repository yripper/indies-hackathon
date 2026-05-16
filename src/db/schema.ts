import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  real,
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

// Structured audio detection events. tool_calls stores the Spanish prose the
// LLM sees; this table stores the verdict in a queryable shape (tier + score
// + per-model breakdown + audio metadata) so the dashboard doesn't have to
// regex Spanish text to render cards or aggregate by outcome.
export const audioAnalyses = pgTable(
  'audio_analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // Nullable: if the agent_run row is later purged for any reason we keep
    // the analysis record — the audio history matters even if the run trace
    // is gone.
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),

    // Audio metadata captured at the moment of analysis. These values are
    // otherwise ephemeral (the in-memory cache evicts them on read), so this
    // is the only place they're persisted.
    durationSec: integer('duration_sec').notNull(),
    bytes: integer('bytes').notNull(),
    mimetype: text('mimetype').notNull(),
    source: text('source').notNull(), // 'direct' | 'quoted'
    fromName: text('from_name'),

    // Structured detector verdict. `detector` is the engine that ran (today
    // always 'reality-defender'; opens room for AASIST or a vendor switch
    // without changing the schema).
    detector: text('detector').notNull(),
    tier: text('tier').notNull(), // 'real' | 'uncertain' | 'fake'
    score: real('score').notNull(),
    rawStatus: text('raw_status').notNull(),
    modelScores: jsonb('model_scores'),
    latencyMs: integer('latency_ms').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audio_analyses_conv_idx').on(table.conversationId, table.createdAt),
    index('audio_analyses_tier_idx').on(table.tier, table.createdAt),
  ],
);

export const imageAnalyses = pgTable(
  'image_analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),
    bytes: integer('bytes').notNull(),
    mimetype: text('mimetype').notNull(),
    source: text('source').notNull(),
    fromName: text('from_name'),
    detector: text('detector').notNull(),
    tier: text('tier').notNull(),
    score: real('score').notNull(),
    rawStatus: text('raw_status').notNull(),
    modelScores: jsonb('model_scores'),
    secondaryDetector: jsonb('secondary_detector'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('image_analyses_conv_idx').on(table.conversationId, table.createdAt),
    index('image_analyses_tier_idx').on(table.tier, table.createdAt),
  ],
);
