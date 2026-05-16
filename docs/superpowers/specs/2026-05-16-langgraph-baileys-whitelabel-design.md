# LangGraph + Baileys Whitelabel Agent — Design Spec

**Date:** 2026-05-16
**Status:** Draft, pending implementation
**Source repo to borrow from:** `/Users/coderipper/Dev/zeddy/backend`

## Purpose

Build a generic, whitelabel WhatsApp agentic bot foundation that:

1. Connects to WhatsApp via Baileys (multi-device, encrypted auth state on disk)
2. Runs incoming messages through a LangGraph.js agent with tool-use loop
3. Persists conversations, messages, agent runs, and tool calls to Postgres
4. Is configured entirely from a single `agent.config.yaml` so the same code can be pivoted to any use case by swapping the YAML and tool registry

The target is hackathon-grade quality: minimal surface, no dead code, idiomatic patterns, with the path to production (Postgres checkpointer, auth, multi-tenancy) clearly parked for later.

## Non-goals (v0)

- Multi-tenant SaaS (single WhatsApp number, single agent config)
- Authentication / users (no JWT, no /login)
- Billing / subscriptions
- Streaming LLM responses
- Resumable runs across server restarts (use `MemorySaver`)
- Web admin UI (use psql + debug endpoints)
- Proactive outbound messages (agent only responds, doesn't initiate)
- Real ML detectors (test tools are generic — calculator etc.)

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 22 + TypeScript (ESM) | Matches zeddy |
| Package manager | **pnpm** | Lockfile and workspace ergonomics |
| HTTP | Fastify 5 | Matches zeddy |
| DB | PostgreSQL 18 + Drizzle ORM | No RLS in v0 |
| WhatsApp | `@whiskeysockets/baileys` 7.0.0-rc10 | Pinned, do not downgrade — Baileys 7 `@lid` quirk handled |
| Agent | `@langchain/langgraph` + `@langchain/core` | StateGraph + ToolNode + MemorySaver |
| LLM bindings | `@langchain/anthropic`, `@langchain/openai` | Provider chosen by config |
| Validation | Zod 4 | Env + YAML config + tool args |
| Tests | Vitest 4 | Mocked LLM, real DB against `indies_test` |
| Crypto | Node `node:crypto` (AES-256-GCM) | For Baileys auth state at rest |

No Supabase, no LangChain RAG, no heavy frameworks beyond LangGraph itself.

## Architecture

### Data flow per incoming WhatsApp message

```
┌──────────────┐    QR pair    ┌─────────────────────┐
│   WhatsApp   │ ◄───────────► │  Baileys WASocket   │
└──────┬───────┘               │  (session-manager)  │
       │ message               └──────────┬──────────┘
       ▼                                  │ messages.upsert
┌─────────────────┐                       ▼
│ Customer phone  │              ┌─────────────────────┐
└─────────────────┘              │   message-router    │
                                 │  (transport layer)  │
                                 └──────────┬──────────┘
                                            │
                  ┌─────────────────────────┴──────────────────────────┐
                  ▼                                                    ▼
        ┌──────────────────┐                              ┌──────────────────────┐
        │ Postgres (durable)│                              │  LangGraph agent     │
        │  - conversations  │  load history ─────────────► │  - StateGraph        │
        │  - messages       │ ◄──────────── save reply    │  - agent node (LLM)  │
        │  - agent_runs     │ ◄──────────── save trace    │  - tool node         │
        │  - tool_calls     │                              │  - MemorySaver       │
        └──────────────────┘                              └─────────┬────────────┘
                                                                    │
                                                                    ▼
                                                         ┌──────────────────────┐
                                                         │  Tools registry      │
                                                         │  - get_current_time  │
                                                         │  - calculator        │
                                                         │  - echo              │
                                                         └──────────────────────┘
```

### Step-by-step (incoming message)

1. Baileys emits `messages.upsert` → `SessionManager` invokes message callback
2. `message-router.handleIncomingMessage()` extracts text + customer phone + customer name
3. Find or create `conversations` row keyed by `customer_phone`
4. Append user `messages` row
5. Load last N messages (config: `limits.history_window`) → format as LangChain message list
6. Start an `agent_runs` row in status `running`
7. Invoke graph: `graph.invoke({ messages }, { configurable: { thread_id: conversation.id } })` wrapped in `Promise.race` against `limits.per_message_timeout_ms`
8. Graph runs: agent node calls LLM with tools bound; if `tool_calls` present → tool node executes → loop back; else END
9. After graph returns, extract trace (tool invocations, iterations, token usage if present)
10. Persist assistant `messages` row; finalize `agent_runs` row; insert one `tool_calls` row per tool invocation
11. Send reply via Baileys `sender.send(to, text)`
12. On any failure path, send a fallback reply ("Sorry, I hit an error. Try again."), mark run `failed`, log error

### What we borrow from zeddy verbatim

- `src/transport/baileys/session-manager.ts` — Baileys lifecycle, reconnect with 5s backoff, encrypted auth, `@lid` capture
- `src/transport/baileys/encrypted-auth-state.ts` — encrypted Baileys auth state adapter
- `src/transport/baileys/sender.ts` — JID normalization, send wrapper
- `src/transport/baileys/connect-client.ts` — slimmed to drop `clientId` parameter (single-tenant)
- `src/security/session-crypto.ts` and `src/security/session-store.ts` — AES-256-GCM session encryption
- `src/config/env.ts` — Zod-validated env pattern
- `src/db/connection.ts` — Drizzle setup (drop `withTenant`/`withoutRls` helpers; no RLS in v0)
- `src/shutdown.ts` — graceful shutdown pattern

### What we rewrite

- `src/transport/message-router.ts` — slimmed; replace zeddy's `chat()` call with `graph.invoke()`
- `src/db/schema.ts` — four tables only (see Database section)
- `src/api/*` — only `/health`, `/v1/wa/*`, and dev-only debug routes

### What we drop entirely

- Auth (JWT, users, login)
- Multi-tenancy (clients, RLS, withTenant, withoutRls helpers)
- Billing (plans, subscriptions, Mercado Pago)
- Menu items
- Handoff flow + summarization to owner
- Owner-message bidirectional router
- Background jobs (handoff timeout recovery)
- Token-pricing tables (`model_pricing`, `llm_usage`) — we capture token counts on `agent_runs` directly

## Module structure

```
indies-hackathon/
├── agent.config.yaml             # whitelabel config (swap to pivot)
├── package.json                  # pnpm
├── pnpm-lock.yaml
├── tsconfig.json
├── docker-compose.yml            # Postgres only
├── drizzle.config.ts
├── vitest.config.ts
├── .env.example
├── .env.test.example
├── .gitignore
├── README.md
├── CLAUDE.md                     # project conventions (slim)
│
├── drizzle/
│   └── 0000_init.sql
│
├── sessions/                     # Baileys encrypted auth (gitignored)
│
├── src/
│   ├── index.ts                  # bootstrap: load config, build deps, start Fastify
│   ├── shutdown.ts               # ported from zeddy
│   │
│   ├── config/
│   │   ├── env.ts                # Zod env schema
│   │   └── agent-config.ts       # YAML loader + Zod schema
│   │
│   ├── db/
│   │   ├── connection.ts         # Drizzle setup (no RLS helpers)
│   │   ├── schema.ts             # 4 tables
│   │   └── queries/
│   │       ├── conversations.ts
│   │       ├── messages.ts
│   │       ├── agent-runs.ts
│   │       └── tool-calls.ts
│   │
│   ├── security/
│   │   ├── session-crypto.ts     # ported verbatim
│   │   └── session-store.ts      # ported verbatim
│   │
│   ├── transport/
│   │   ├── baileys/
│   │   │   ├── session-manager.ts        # ported verbatim
│   │   │   ├── encrypted-auth-state.ts   # ported verbatim
│   │   │   ├── sender.ts                 # ported verbatim
│   │   │   └── connect-client.ts         # slimmed (no clientId)
│   │   └── message-router.ts             # rewritten: invokes agent
│   │
│   ├── agent/
│   │   ├── graph.ts              # buildGraph(config, llm, tools)
│   │   ├── nodes/
│   │   │   ├── agent-node.ts     # LLM-with-tools call
│   │   │   └── tool-node.ts      # ToolNode wrapper
│   │   ├── llm.ts                # provider factory: anthropic | openai
│   │   ├── trace.ts              # extract trace from final state
│   │   └── tools/
│   │       ├── index.ts          # registry + resolveTools()
│   │       ├── get-current-time.ts
│   │       ├── calculator.ts
│   │       └── echo.ts
│   │
│   └── api/
│       ├── health.ts             # GET /health
│       ├── wa.ts                 # POST /v1/wa/connect, /disconnect, /logout; GET /status
│       └── debug.ts              # GET /v1/conversations, /v1/runs/:id (dev-only)
│
└── tests/
    ├── agent/
    │   ├── graph.test.ts
    │   └── tools/
    │       ├── calculator.test.ts
    │       ├── get-current-time.test.ts
    │       └── echo.test.ts
    ├── transport/
    │   └── message-router.test.ts
    ├── db/
    │   └── queries.test.ts
    └── helpers/
        ├── clean-db.ts
        └── mock-llm.ts
```

### Boundary rules

- `agent/` is the only place LangGraph is imported. `transport/` and `api/` never touch LangGraph types directly — they receive an opaque `invokeGraph` dep.
- `transport/baileys/` is the only place Baileys is imported.
- `db/queries/` is the only place Drizzle is imported. Routes and transport never call Drizzle.
- Adding a tool: create `src/agent/tools/<name>.ts`, register in `src/agent/tools/index.ts`, enable in `agent.config.yaml`.

## Database

### Drizzle schema (`src/db/schema.ts`)

```ts
import {
  pgTable, uuid, text, jsonb, timestamp, integer, boolean,
} from 'drizzle-orm/pg-core';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerPhone: text('customer_phone').notNull().unique(),
  customerName: text('customer_name'),
  status: text('status').notNull().default('active'),
  // status enum: 'active' | 'closed' | 'paused'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  // role enum: 'user' | 'assistant' | 'system' | 'tool'
  content: text('content').notNull(),
  toolName: text('tool_name'),
  toolCallId: text('tool_call_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  triggerMessageId: uuid('trigger_message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  agentName: text('agent_name').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull(),
  // status enum: 'running' | 'completed' | 'failed' | 'capped'
  iterations: integer('iterations').notNull().default(0),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
});

export const toolCalls = pgTable('tool_calls', {
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
});
```

### Indexes

- `messages (conversation_id, created_at DESC)` — history lookup
- `agent_runs (conversation_id, started_at DESC)` — debug
- `tool_calls (agent_run_id, invoked_at)` — trace order

Added in initial migration.

### Postgres roles

Single role (`indies`, matching the `DATABASE_URL` user) with full access. No RLS, no `withTenant`. This is a deliberate simplification from zeddy — re-add when v1 needs multi-tenancy.

## Agent config (`agent.config.yaml`)

```yaml
agent:
  name: "test-agent"
  system_prompt: |
    You are a helpful agent that responds to WhatsApp messages.
    When you need information you don't have, use available tools.
    Keep responses concise — under 3 short paragraphs.

provider:
  name: "anthropic"            # 'anthropic' | 'openai'
  model: "claude-sonnet-4-6"
  temperature: 0.3
  max_tokens: 1024

tools:
  enabled:
    - "get_current_time"
    - "calculator"
    - "echo"
  config:                       # per-tool config bag (optional, unused in v0)
    calculator:
      max_precision: 10

limits:
  max_tool_iterations: 5
  history_window: 30
  per_message_timeout_ms: 60000
```

### Zod schema (`src/config/agent-config.ts`)

```ts
import { z } from 'zod';

export const AgentConfigSchema = z.object({
  agent: z.object({
    name: z.string().min(1),
    system_prompt: z.string().min(1),
  }),
  provider: z.object({
    name: z.enum(['anthropic', 'openai']),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.3),
    max_tokens: z.number().int().positive().default(1024),
  }),
  tools: z.object({
    enabled: z.array(z.string()).default([]),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  limits: z.object({
    max_tool_iterations: z.number().int().min(1).default(5),
    history_window: z.number().int().min(1).default(30),
    per_message_timeout_ms: z.number().int().positive().default(60000),
  }),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

Invalid YAML or missing required fields → server exits at boot, no silent defaults.

## LangGraph agent

### Graph shape

```
                    ┌─────────┐
       START ──────►│  agent  │
                    └────┬────┘
                         │
              ┌──────────┴──────────┐
              │ tool_calls present? │
              └──────────┬──────────┘
              yes        │         no
              ▼          │         ▼
        ┌─────────┐      │       END
        │  tools  │      │
        └────┬────┘      │
             │           │
             └───────────┘
              (back to agent)
```

ReAct-style. Two nodes, one conditional edge.

### Skeleton (`src/agent/graph.ts`)

```ts
import { StateGraph, MessagesAnnotation, MemorySaver } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';

type BuildGraphInput = {
  llm: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  maxIterations: number;
};

export function buildGraph(input: BuildGraphInput) {
  const llmWithTools = input.llm.bindTools(input.tools);

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const messages = [
      { role: 'system', content: input.systemPrompt },
      ...state.messages,
    ];
    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1];
    const hasToolCalls =
      'tool_calls' in last &&
      Array.isArray(last.tool_calls) &&
      last.tool_calls.length > 0;
    const assistantCount = state.messages.filter((m) => m._getType() === 'ai').length;
    if (assistantCount >= input.maxIterations) return '__end__';
    return hasToolCalls ? 'tools' : '__end__';
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', new ToolNode(input.tools))
    .addEdge('__start__', 'agent')
    .addConditionalEdges('agent', shouldContinue, { tools: 'tools', __end__: '__end__' })
    .addEdge('tools', 'agent');

  return graph.compile({ checkpointer: new MemorySaver() });
}
```

### LLM provider factory (`src/agent/llm.ts`)

```ts
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentConfig } from '../config/agent-config';

export function buildLlm(config: AgentConfig['provider']): BaseChatModel {
  if (config.name === 'anthropic') {
    return new ChatAnthropic({
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.max_tokens,
    });
  }
  return new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
  });
}
```

Only the API key for the configured provider must be present in env. Boot validates this.

### Tool shape

```ts
// src/agent/tools/calculator.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const calculatorTool = tool(
  async ({ expression }) => {
    const result = evaluateExpression(expression); // safe-eval, no Function()
    return String(result);
  },
  {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression. Supports +, -, *, /, parentheses.',
    schema: z.object({
      expression: z.string().describe('e.g. "2 + 2 * 3"'),
    }),
  },
);
```

### Registry (`src/agent/tools/index.ts`)

```ts
import { calculatorTool } from './calculator';
import { getCurrentTimeTool } from './get-current-time';
import { echoTool } from './echo';

const REGISTRY = {
  calculator: calculatorTool,
  get_current_time: getCurrentTimeTool,
  echo: echoTool,
} as const;

export type ToolName = keyof typeof REGISTRY;

export function resolveTools(enabled: string[]) {
  return enabled.map((name) => {
    const t = REGISTRY[name as ToolName];
    if (!t) throw new Error(`Unknown tool in agent.config.yaml: ${name}`);
    return t;
  });
}
```

### The three v0 tools

| Tool | Args | Returns |
|---|---|---|
| `get_current_time` | `{ timezone?: string }` (IANA, defaults to UTC) | ISO-8601 string |
| `calculator` | `{ expression: string }` | string result of arithmetic eval |
| `echo` | `{ text: string }` | the same text (sanity check tool) |

### Trace capture (`src/agent/trace.ts`)

After `graph.invoke()` returns the final state, walk `state.messages` and pair each `AIMessage.tool_calls[*]` with the following `ToolMessage` (by `tool_call_id`). Sum `usage_metadata` from AIMessages if provider exposes it. Return:

```ts
type TraceResult = {
  finalText: string;
  toolCalls: Array<{
    name: string;
    toolCallId: string;
    args: unknown;
    result: unknown;
    latencyMs: number;
    succeeded: boolean;
    error?: string;
  }>;
  iterations: number;
  inputTokens?: number;
  outputTokens?: number;
};
```

Per-tool latency is captured by wrapping each tool's invocation. Approach: a small `withTimingAndTrace` higher-order helper applied in `resolveTools` that records start/end times into a per-run map keyed by `tool_call_id`. The trace extractor reads from that map after `graph.invoke()` completes.

## Message router integration

```ts
// src/transport/message-router.ts (sketch)
async function handleIncomingMessage(deps, msg) {
  const conversation = await deps.findOrCreateConversation(msg.customerPhone, msg.customerName);
  if (conversation.status !== 'active') return;

  const userMsg = await deps.saveUserMessage(conversation.id, msg.text);
  const history = await deps.listRecentMessages(conversation.id, deps.config.limits.history_window);

  const runRow = await deps.startAgentRun({
    conversationId: conversation.id,
    triggerMessageId: userMsg.id,
    config: deps.config,
  });

  try {
    const result = await Promise.race([
      deps.invokeGraph({
        messages: history.map(toLangChainMessage),
        thread_id: conversation.id,
      }),
      timeoutAfter(deps.config.limits.per_message_timeout_ms),
    ]);
    const trace = extractTrace(result);

    await deps.saveAssistantMessage(conversation.id, trace.finalText);
    await deps.finishAgentRun(runRow.id, trace);
    await deps.persistToolCalls(runRow.id, trace.toolCalls);
    await deps.send(msg.customerPhone, trace.finalText);
  } catch (err) {
    await deps.failAgentRun(runRow.id, err);
    await deps.send(msg.customerPhone, 'Sorry, I hit an error. Try again.');
  }
}
```

## HTTP API

All under `/v1/` except `/health`. No auth in v0.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness probe |
| `POST` | `/v1/wa/connect` | start Baileys session. Body `{ method?: 'qr' \| 'pairing-code', phoneNumber?: string }`. Returns `{ qrCode }` on first connect, `{ status: 'connected' }` if already paired, or `{ pairingCode }` if pairing-code requested |
| `POST` | `/v1/wa/disconnect` | end session, keep auth files (next connect skips QR) |
| `POST` | `/v1/wa/logout` | end session + wipe auth files (next connect forces fresh QR) |
| `GET` | `/v1/wa/status` | `{ connected, phone, lid }` |
| `GET` | `/v1/conversations` | list conversations (dev-only via `NODE_ENV` guard) |
| `GET` | `/v1/conversations/:id/messages` | full thread (dev-only) |
| `GET` | `/v1/runs/:id` | run trace including tool_calls (dev-only) |

Debug routes are registered only when `NODE_ENV !== 'production'`.

## Environment variables

```bash
# Postgres
DATABASE_URL=postgres://indies:indies@localhost:5432/indies

# LLM keys (only the one matching agent.config.yaml's provider must be set)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Baileys
WA_SESSION_KEY=                 # openssl rand -hex 32 — DO NOT rotate
SESSIONS_DIR=./sessions

# Server
PORT=3000
HOST=0.0.0.0

# Agent config path
AGENT_CONFIG_PATH=./agent.config.yaml

# Node env
NODE_ENV=development
```

Validation: Zod schema at boot. Missing required keys → exit non-zero.

## Error handling

| Failure | Where caught | Outcome |
|---|---|---|
| Invalid `agent.config.yaml` | boot (Zod) | exit non-zero |
| Missing API key for configured provider | boot (`buildLlm`) | exit non-zero |
| Baileys disconnect (transient) | `session-manager` | reconnect after 5s |
| Baileys logged out | `session-manager` | wipe session, emit `disconnected`, require re-pair |
| LLM error (network/rate-limit) | `agent-node` → router | mark run `failed`, send fallback, log |
| Tool throws | `ToolNode` returns error string to LLM | LLM sees error, can retry or abandon; recorded in `tool_calls.error` |
| `max_tool_iterations` exceeded | `shouldContinue` ends graph | run `capped`, partial response if any else apology |
| `per_message_timeout_ms` exceeded | `Promise.race` in router | run `failed`, fallback sent |
| Postgres connection lost | repository throws | propagates, run `failed`, process supervisor restarts if persistent |
| Duplicate Baileys delivery | `messages.upsert` listener | dedupe by Baileys `message.key.id` before persist |

**Invariant: every code path through the agent ends with the user receiving a WhatsApp reply.** Silence is the worst outcome.

## Testing strategy

Vitest, mirrors zeddy.

**1. Unit — tools** (no DB, no LLM, no network)
- Each tool has matching `*.test.ts`
- Happy path, error path, Zod schema validation

**2. Graph — mocked LLM** (no network)
- `tests/helpers/mock-llm.ts` exports `BaseChatModel` subclass returning scripted responses
- Assert: agent calls correct tool with correct args given history X
- Assert: agent loops back from tool result and returns final text
- Assert: iteration cap stops the loop after N rounds

**3. Integration — real DB, mocked LLM, mocked Baileys send**
- `tests/transport/message-router.test.ts`: incoming → persisted user msg → graph invocation → assistant reply persisted → trace persisted
- `cleanDb` helper truncates between tests
- Test DB: `indies_test`

**Out of scope for v0 tests:** real LLM calls, real Baileys pairing, load tests.

### CI guard

```bash
pnpm verify   # = tsc --noEmit && vitest run
```

## Parking lot (v1+, not in v0)

- Streaming LLM responses (typing indicator UX)
- Postgres checkpointer (resumable runs across restarts)
- Web admin UI (replace psql + debug endpoints)
- Tool config injection (`tools.config` YAML field is reserved, not wired)
- Auth/JWT (single-tenant assumption holds)
- Conversation status transitions via tools (`close_conversation`, `pause_conversation`)
- Background jobs / scheduled tasks
- Outbound proactive messages
- Multiple parallel WA sessions (multi-tenancy return)
- Real ML detectors (audio/image) — added as new tools when use case is locked

## Acceptance criteria for v0 "done"

1. `pnpm install && pnpm verify` passes (`tsc --noEmit` + all Vitest tests)
2. `pnpm dev` boots the server, parses `agent.config.yaml`, fails loud on bad config
3. `POST /v1/wa/connect` returns a scannable QR code on first run
4. After pairing, sending a WhatsApp message to the bot results in an agent reply within `per_message_timeout_ms`
5. `GET /v1/runs/:id` returns the run trace with tool calls for the most recent message
6. Swapping `agent.config.yaml` (different system prompt, different tool whitelist) and restarting changes agent behavior with no code changes
7. All four tables (`conversations`, `messages`, `agent_runs`, `tool_calls`) populate correctly on a happy-path message exchange
8. Killing the server during a run and restarting does not corrupt the DB; in-flight run is left as `running` (acceptable — graceful shutdown handler will mark stale runs `failed` in a future iteration)

## Open follow-ups (deferred decisions)

- Pairing-code vs QR-only for v0 demo: implementation supports both, demo will choose closer to date
- Whether `agent_runs.input_tokens` / `output_tokens` are populated depends on provider exposing `usage_metadata`. Anthropic does, OpenAI does. Acceptable to leave null on edge cases.
- Per-tool latency capture method: documented as `withTimingAndTrace` wrapper around `resolveTools`. Final form decided during implementation.
- Project / pnpm package name: design uses the folder name `indies-hackathon` as placeholder. Final name chosen before `pnpm init`.
