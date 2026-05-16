# indies-hackathon

Single-tenant, white-label WhatsApp agentic bot. LangGraph.js + Baileys + Postgres.

## Quickstart

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
openssl rand -hex 32   # paste as WA_SESSION_KEY in .env
pnpm db:migrate
pnpm db:setup:test
pnpm test              # all green
pnpm dev               # http://localhost:3000
```

Edit `agent.config.yaml` and restart to change the agent's behavior.

See `docs/superpowers/specs/2026-05-16-langgraph-baileys-whitelabel-design.md` for full design.
