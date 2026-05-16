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

## Switching providers (no code changes)

| Want | `agent.config.yaml` | `.env` |
|---|---|---|
| OpenAI | `name: openai`, `model: gpt-5.4-mini` | `OPENAI_API_KEY=sk-...`, `OPENAI_BASE_URL=` (empty) |
| MiniMax | `name: openai`, `model: MiniMax-M2` | `OPENAI_API_KEY=<minimax-key>`, `OPENAI_BASE_URL=https://api.minimax.io/v1` |
| Anthropic | `name: anthropic`, `model: claude-sonnet-4-6` | `ANTHROPIC_API_KEY=sk-ant-...` |

Edit the two files, restart the server (`Ctrl-C` + `pnpm dev`), done.

---

## Adding tools

To add a tool the agent can call:

1. Create `src/agent/tools/<name>.ts`:

   ```ts
   import { tool } from '@langchain/core/tools';
   import { z } from 'zod/v3';   // ← see "Zod quirk" below

   export const myTool = tool(
     async ({ foo }) => `result for ${foo}`,
     {
       name: 'my_tool',
       description: 'Describe what this tool does to help the LLM decide when to call it.',
       schema: z.object({
         foo: z.string().describe('what foo means'),
       }),
     },
   );
   ```

2. Register it in `src/agent/tools/index.ts`:

   ```ts
   import { myTool } from './my-tool';
   const REGISTRY: Record<string, StructuredToolInterface> = {
     // ...existing tools
     my_tool: myTool,
   };
   ```

3. Enable it in `agent.config.yaml`:

   ```yaml
   tools:
     enabled:
       - "my_tool"
   ```

4. Add a unit test in `tests/agent/tools/<name>.test.ts`.

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
