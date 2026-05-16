# indies-hackathon

Single-tenant, white-label WhatsApp agentic bot. LangGraph.js + Baileys + Postgres.

The same code base can be pivoted to any use case by editing `agent.config.yaml` and the tools in `src/agent/tools/`. The LLM provider is swappable between OpenAI, MiniMax (and any OpenAI-compatible endpoint — Groq, DeepSeek, Together, etc.), and Anthropic via config alone.

---

## Requirements

- **Node 22+** (uses ESM, `target: ES2023`)
- **pnpm 9+**
- **Docker** (for Postgres 18)
- An LLM API key for one of: OpenAI, MiniMax, Anthropic, or any other OpenAI-compatible endpoint
- A WhatsApp account on a phone you control (for pairing)

## Local setup

### 1. Clone and install

```bash
pnpm install
```

### 2. Start Postgres

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_isready -U indies -d indies   # should say "accepting connections"
```

### 3. Create environment files

```bash
cp .env.example .env
cp .env.test.example .env.test
```

Edit `.env`:

- **`WA_SESSION_KEY`** — generate once, never rotate (rotating invalidates every Baileys pairing on disk):
  ```bash
  openssl rand -hex 32
  ```
  Paste the result into `.env` as `WA_SESSION_KEY=...` (must be exactly 64 hex chars).
- **LLM keys** — set the one(s) for the provider(s) you'll use. See the [LLM provider setup](#llm-provider-setup) section below for specifics.

### 4. Apply database migrations

```bash
pnpm db:migrate            # dev DB (indies)
pnpm db:setup:test         # test DB (indies_test)
```

### 5. Verify

```bash
pnpm verify                # tsc --noEmit + vitest run (46 tests)
```

If `tsc --noEmit` OOMs at 4 GB (deeply generic LangChain + Zod-v3-via-subpath types), bump:

```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm verify
```

Runtime is unaffected — this is a checker-only cost.

### 6. Start the server

```bash
pnpm dev                   # tsx watch, hot reload
# or
pnpm start                 # tsx without watch
```

Server listens on `http://localhost:3000`. Logs are structured JSON via Fastify/pino.

### 7. Pair your WhatsApp

```bash
curl -X POST http://localhost:3000/v1/wa/connect | jq
```

Response: `{ "status": "qr", "qrCode": "..." }`

Paste the `qrCode` string into [qr-code-generator.com](https://www.qr-code-generator.com/) (Free Text mode), then scan it from your phone: **WhatsApp → Settings → Linked devices → Link a device**.

Check status:

```bash
curl http://localhost:3000/v1/wa/status
# { "connected": true, "phone": "56...", "lid": "...", "qrCode": null }
```

After pairing, the encrypted session is saved to `./sessions/` and **the bot auto-restores the connection on every server restart** — no need to pair again unless you delete the `sessions/` directory.

### 8. Send a test message

From any other phone, send a WhatsApp message to the paired number. The bot replies via the configured LLM + tools.

Inspect what happened:

```bash
# List recent conversations
curl http://localhost:3000/v1/conversations | jq

# Messages in a conversation
curl http://localhost:3000/v1/conversations/<id>/messages | jq

# Agent runs (each inbound message triggers one)
docker compose exec -T postgres psql -U indies -d indies \
  -c "select id, status, iterations, latency_ms from agent_runs order by started_at desc limit 5;"

# Full run trace including tool calls
curl http://localhost:3000/v1/runs/<id> | jq
```

---

## LLM provider setup

The provider is chosen in `agent.config.yaml` and authenticated via `.env`. **You only need a key for the provider you're actually using.**

### A. OpenAI proper (gpt-5.4-mini, gpt-4o, etc.)

`agent.config.yaml`:
```yaml
provider:
  name: "openai"
  model: "gpt-5.4-mini"
  temperature: 0.3
  max_tokens: 1024
```

`.env`:
```bash
OPENAI_API_KEY=sk-proj-...
# Leave OPENAI_BASE_URL empty/unset
```

**Quirk:** GPT-5.x and o-series models reject the legacy `max_tokens` parameter. We forward it as `max_completion_tokens` via `modelKwargs` — no action needed on your part, just be aware if you read the source.

### B. MiniMax (M2 family) via OpenAI-compatible endpoint

`agent.config.yaml`:
```yaml
provider:
  name: "openai"             # MiniMax exposes an OpenAI-compatible endpoint
  model: "MiniMax-M2"        # or MiniMax-M2.1, M2.5, M2.7, -highspeed variants
  temperature: 0.3
  max_tokens: 1024
```

`.env`:
```bash
OPENAI_API_KEY=<your-minimax-api-key>
OPENAI_BASE_URL=https://api.minimax.io/v1
```

**Quirks:**
- The OpenAI-compat endpoint **only supports the M2 family**. Older `abab-*` models require MiniMax's native API (not supported by this project).
- MiniMax M2 models wrap chain-of-thought in `<think>...</think>` tags inside `content`. We strip these automatically in `src/agent/trace.ts:stripReasoningTags()` before the WhatsApp reply, so users never see the reasoning.
- For the China region instead of international, use `OPENAI_BASE_URL=https://api.minimaxi.com/v1`.

Get a key: [platform.minimax.io](https://platform.minimax.io/).

### C. Anthropic (Claude)

`agent.config.yaml`:
```yaml
provider:
  name: "anthropic"
  model: "claude-sonnet-4-6"     # or claude-opus-4-7, claude-haiku-4-5
  temperature: 0.3
  max_tokens: 1024
```

`.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

No quirks. Native LangChain integration.

### D. Any other OpenAI-compatible provider (Groq, DeepSeek, Together, OpenRouter, etc.)

Same pattern as MiniMax — use `name: "openai"` in YAML, point `OPENAI_BASE_URL` at the provider's `/v1` URL, put their API key in `OPENAI_API_KEY`.

Examples:
| Provider | `OPENAI_BASE_URL` | Model name format |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-70b-versatile` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Together | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` |

---

## Audio deepfake detection

Detects AI-generated voice clones (ElevenLabs, Resemble, etc.) using the Reality Defender SDK. When enabled, the bot can analyze any audio message a user sends via WhatsApp and return a verdict: fake, uncertain, or real.

### Enabling

1. Get a free API key at [app.realitydefender.ai](https://app.realitydefender.ai) (50 scans/month on the free tier).
2. Add to `.env`:
   ```bash
   REALITY_DEFENDER_API_KEY=rd_live_...
   ```
3. Confirm `analyze_audio_deepfake` is listed in `agent.config.yaml` under `tools.enabled` (included by default on this branch).

### How it works

1. **User sends an audio message** → the bot replies "¿Querés que lo analice?" (confirmation prompt).
2. **User confirms** → bot uploads the audio to Reality Defender → returns the verdict with a confidence score.
3. **Audio + text in the same message** (within a 1.5 s window) → the bot skips the confirmation and auto-analyzes immediately.

### Free tier limits

The free plan allows **50 analyses/month**, shared across audio and image scans. When the quota is exhausted the bot replies with a friendly message explaining the limit has been reached and resets next month.

### Dashboard

```bash
cd dashboard && pnpm dev
```

Opens a local analytics UI with KPI cards (total scans, fake %, avg confidence), tier badges (free/pro), and a scrollable conversation history.

---

## Switching providers (no code changes)

| Want | `agent.config.yaml` | `.env` |
|---|---|---|
| OpenAI | `name: openai`, `model: gpt-5.4-mini` | `OPENAI_API_KEY=sk-...`, `OPENAI_BASE_URL=` (empty) |
| MiniMax | `name: openai`, `model: MiniMax-M2` | `OPENAI_API_KEY=<minimax-key>`, `OPENAI_BASE_URL=https://api.minimax.io/v1` |
| Anthropic | `name: anthropic`, `model: claude-sonnet-4-6` | `ANTHROPIC_API_KEY=sk-ant-...` |

Edit the two files, restart the server (`Ctrl-C` + `pnpm dev`), done.

---

## Adding tools

Tools are how the agent reaches the outside world: lookups, calculations, API calls, side effects. Each tool is a single TypeScript file in `src/agent/tools/` plus one line in the registry plus one line in the YAML whitelist.

### Where things live

```
src/agent/tools/
├── index.ts            ← registry: maps tool-name strings to tool implementations
├── echo.ts             ← one tool per file
├── get-current-time.ts
├── calculator.ts
└── <your-tool>.ts      ← new tools go here

tests/agent/tools/
├── echo.test.ts        ← matching test, one per tool
├── get-current-time.test.ts
├── calculator.test.ts
└── <your-tool>.test.ts ← new tests go here

agent.config.yaml       ← lists which registered tools are active for the current agent
```

The flow at boot:

1. `src/index.ts` reads `agent.config.yaml` → gets `tools.enabled` (an array of string names).
2. Calls `resolveTools(enabled)` from `src/agent/tools/index.ts`, which looks each name up in the `REGISTRY` object and returns an array of `StructuredToolInterface` instances.
3. Those tools are passed to `buildGraph()`, which binds them to the LLM and registers them in the LangGraph `ToolNode` for execution.

A tool that isn't in `REGISTRY` will fail loud at boot (`Unknown tool in agent.config.yaml: <name>`). A registered tool that isn't in `tools.enabled` is silently inert — useful for keeping experimental tools in the codebase without exposing them.

### Step 1 — Write the tool

Create `src/agent/tools/<kebab-name>.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';   // ← see "Zod quirk" below — MUST be zod/v3

/**
 * Brief description of what the tool does. The LLM reads `description` to
 * decide when to invoke it, so be concrete and use trigger words the user
 * is likely to say.
 */
export const fetchOrderStatusTool = tool(
  async ({ orderId }) => {
    // Body returns a string (or anything JSON-serializable). The string
    // becomes the ToolMessage content the LLM sees on the next loop iteration.
    const order = await myApi.getOrder(orderId);
    if (!order) return `No order found with id ${orderId}.`;
    return `Order ${orderId}: status=${order.status}, eta=${order.eta}.`;
  },
  {
    name: 'fetch_order_status',                // snake_case — this is what the LLM "calls"
    description:
      'Look up the status of a customer order by its order ID. Use when the user asks "where is my order", "did my order ship", etc.',
    schema: z.object({
      orderId: z
        .string()
        .describe('the order id, e.g. "ORD-12345"'),
    }),
  },
);
```

**Naming conventions:**
- File: `kebab-case.ts` (matches existing tool files)
- Variable: `camelCaseTool` (exported)
- Tool `name` field: `snake_case` (what the LLM sees and calls)

**Schema rules:**
- Use Zod v3 syntax (`z.string()`, `z.number()`, `z.object()`, `z.array()`, `.optional()`, `.describe()`)
- Every property must have a `.describe(...)` — the description shows up in the JSON Schema sent to the LLM and dramatically improves tool-selection quality
- Don't use `z.discriminatedUnion`, `z.intersection`, or other advanced Zod features unless you've verified the OpenAI SDK's `zod-to-json-schema` supports them

**Body rules:**
- Return a string for simplest behavior; the LLM gets it verbatim as the tool result
- Returning structured data (object/array) works too — LangChain will `JSON.stringify` it before showing the LLM
- Throwing an `Error` is acceptable and gets surfaced to the LLM as `"Error: <message>"` — the agent can recover or apologize
- Don't `console.log` from inside tool bodies in production code; use the Fastify logger if you need observability

### Step 2 — Register the tool

Open `src/agent/tools/index.ts` and add two lines:

```ts
import { fetchOrderStatusTool } from './fetch-order-status';   // <-- 1. import

const REGISTRY: Record<string, StructuredToolInterface> = {
  echo: echoTool,
  get_current_time: getCurrentTimeTool,
  calculator: calculatorTool,
  fetch_order_status: fetchOrderStatusTool,                    // <-- 2. register
};
```

The key (`fetch_order_status`) **must match the `name` field on the tool object**. The agent looks tools up by this string.

### Step 3 — Enable it in `agent.config.yaml`

```yaml
tools:
  enabled:
    - "get_current_time"
    - "calculator"
    - "echo"
    - "fetch_order_status"      # ← add here
  config:                       # optional per-tool config bag, not wired yet
    fetch_order_status:
      timeout_ms: 5000
```

Order doesn't matter. Tools not listed here are excluded from the LLM's tool list for this agent.

### Step 4 — Write a test

Create `tests/agent/tools/<kebab-name>.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchOrderStatusTool } from '../../../src/agent/tools/fetch-order-status';

describe('fetchOrderStatusTool', () => {
  it('returns a human-readable status string', async () => {
    // If the tool calls an external API, mock it here with vi.mock or by
    // exposing the dependency. For pure tools (calculator etc.) just invoke.
    const result = await fetchOrderStatusTool.invoke({ orderId: 'ORD-1' });
    expect(result).toMatch(/Order ORD-1/);
  });

  it('handles missing orders gracefully', async () => {
    const result = await fetchOrderStatusTool.invoke({ orderId: 'NONE' });
    expect(result).toMatch(/No order found/);
  });

  it('rejects invalid input via Zod', async () => {
    // @ts-expect-error — intentionally invalid input
    await expect(fetchOrderStatusTool.invoke({ orderId: 123 })).rejects.toThrow();
  });
});
```

Run just the new tool's tests:
```bash
pnpm test tests/agent/tools/fetch-order-status.test.ts
```

Or the whole tool suite:
```bash
pnpm test tests/agent/tools/
```

### Step 5 — Verify end-to-end

```bash
pnpm verify        # tsc + all tests
pnpm dev           # restart server with the new tool active
```

Send a WhatsApp message that should trigger the tool ("where's my order ORD-1234?"). Inspect the run trace:

```bash
docker compose exec -T postgres psql -U indies -d indies \
  -c "select tool_name, arguments, result, succeeded, latency_ms from tool_calls order by invoked_at desc limit 5;"
```

You should see one row per LLM tool call with the arguments it chose and the result your function returned.

### Tool design tips

- **Be specific in `description`.** "Search the web" is bad; "Search Google for current news articles published in the last 24 hours about <topic>; returns titles and URLs" is good. The LLM picks tools by reading this text.
- **Prefer narrow tools over wide ones.** Two tools `get_weather` + `get_forecast` outperform one `weather_thing` with a mode parameter.
- **Return strings the LLM will quote back.** If you return `"42"`, the user will see `"42"` in the reply unless the system prompt tells the model to rephrase. Return prose if you want prose.
- **Side effects need confirmation flows.** If a tool mutates state (sends a payment, books a meeting), have it return a "ready to confirm — say YES" string and require a second tool call (`confirm_<action>`) to actually execute. The agent loop handles this naturally because the LLM sees the first result and decides whether to call the second.
- **Don't catch errors silently.** Let them throw — the LLM will see the error and either retry with different args or apologize to the user. Hidden failures look like bugs.

### Zod quirk

Tool files must `import { z } from 'zod/v3'` (the Zod v3 compat subpath bundled inside Zod 4). The rest of the project uses Zod 4 directly. Reason: `@langchain/openai@0.3.17` calls into the OpenAI SDK's bundled Zod-3-only JSON-Schema converter, which rejects Zod 4 schemas with a confusing `Cannot read properties of undefined (reading 'typeName')` at runtime.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness probe |
| `POST` | `/v1/wa/connect` | start Baileys session, returns QR (first time) or `connected` status |
| `POST` | `/v1/wa/disconnect` | end session, keep auth files |
| `GET` | `/v1/wa/status` | `{ connected, phone, lid, qrCode }` |
| `GET` | `/v1/conversations` | list conversations *(dev-only, `NODE_ENV != production`)* |
| `GET` | `/v1/conversations/:id/messages` | messages in a conversation *(dev-only)* |
| `GET` | `/v1/runs/:id` | run trace with tool calls *(dev-only)* |

---

## Troubleshooting

### "WA_SESSION_KEY must be 64 hex chars (32 bytes)"
You forgot to fill it in or used the wrong length. Generate with `openssl rand -hex 32` and paste into `.env`.

### `/v1/wa/status` shows `connected: false` after pairing
The Baileys socket dropped. The server attempts auto-reconnect every 5 s for transient drops. Hit `POST /v1/wa/connect` again — it reuses the on-disk creds, no new QR scan needed.

### "400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
You're on a GPT-5.x/o-series model. We already forward via `modelKwargs.max_completion_tokens` — this error means an old build is running. Restart `pnpm dev`.

### "400 schema must be a JSON Schema of 'type: object', got 'type: None'"
A tool file is using `import { z } from 'zod'` (Zod 4) instead of `import { z } from 'zod/v3'`. Fix the import.

### Server starts but doesn't reply to WhatsApp messages
Check the DB: `select count(*) from messages;`. If 0, the message isn't being received — check `/v1/wa/status` shows `connected: true` and your phone is actually paired. If > 0 but no reply, check `select error_message from agent_runs order by started_at desc limit 1;`.

### `tsc --noEmit` runs out of memory
LangChain + Zod-v3-via-subpath inference is heavy. Bump heap:
```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm verify
```

### Tests fail with "fileParallelism" or database race
The test suite runs sequentially across files (see `vitest.config.ts` — `fileParallelism: false`). If you've copied tests into other folders that share `indies_test`, keep that setting.

---

## Project layout

```
src/
├── index.ts                bootstrap
├── shutdown.ts             SIGINT/SIGTERM handler
├── config/
│   ├── env.ts              Zod-validated env vars
│   └── agent-config.ts     YAML loader + Zod schema
├── db/
│   ├── connection.ts       Drizzle setup
│   ├── schema.ts           4 tables: conversations, messages, agent_runs, tool_calls
│   └── queries/            repository pattern, one file per table
├── security/
│   ├── session-crypto.ts   AES-256-GCM for Baileys auth state
│   └── session-store.ts
├── transport/
│   ├── baileys/
│   │   ├── session-manager.ts    single-socket Baileys lifecycle + reconnect
│   │   ├── encrypted-auth-state.ts
│   │   ├── sender.ts
│   │   └── connect-client.ts     DM filter + text extraction
│   ├── wa-session.ts             stateful WaSession controller (used by both API and boot)
│   └── message-router.ts         load history → invoke graph → persist → send
├── agent/
│   ├── graph.ts            LangGraph StateGraph + ToolNode + iteration cap
│   ├── llm.ts              provider factory (openai-compat | anthropic)
│   ├── trace.ts            extract tool calls + strip <think> tags
│   └── tools/              echo, get_current_time, calculator + registry
└── api/
    ├── health.ts
    ├── wa.ts               /v1/wa/{connect,disconnect,status}
    └── debug.ts            /v1/conversations, /v1/runs/:id (dev-only)
```

---

## Design docs

- Spec: [`docs/superpowers/specs/2026-05-16-langgraph-baileys-whitelabel-design.md`](docs/superpowers/specs/2026-05-16-langgraph-baileys-whitelabel-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-16-langgraph-baileys-whitelabel.md`](docs/superpowers/plans/2026-05-16-langgraph-baileys-whitelabel.md)
