# :shield: VERITAS

> **Plataforma anti-desinformación para WhatsApp** — detecta deepfakes en audio, imagen y video, verifica noticias, y protege grupos automáticamente.

[![Node 22](https://img.shields.io/badge/node-22-brightgreen?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![HF Space](https://img.shields.io/badge/HF%20Space-live-orange?logo=huggingface)](https://dr4k3n-deepfake-detector.hf.space)
[![CI](https://img.shields.io/github/actions/workflow/status/yripper/indies-hackathon/ci.yml?label=CI)](https://github.com/yripper/indies-hackathon/actions)

Built for **hack@latam 2026**.

---

## How it works

```
User (WhatsApp)
     │
     ▼
 Baileys Transport
     │
     ▼
 LangGraph Agent ──────────────────────────────────────────────────┐
     │                                                             │
     ├── Media Detection                                           │
     │       ├── Audio  → Reality Defender SDK                    │
     │       ├── Image  → Reality Defender + Sightengine           │
     │       └── Video  → HF Space (OpenCV heuristics + ML)        │
     │                                                             │
     ├── Intelligence                                              │
     │       ├── Fact-Check → Google Fact Check API + DuckDuckGo  │
     │       └── URL Scan   → YouTube / TikTok / Twitter / IG     │
     │                                                             │
     └── Output ◄────────────────────────────────────────────────┘
             ├── Verdict + confidence score
             ├── Frame heatmap PNG (video)
             └── Authenticity certificate PNG (verified content)
```

---

## Features

| Media Detection | Intelligence & Safety |
|---|---|
| :microphone: **Audio deepfake** — Reality Defender SDK scores every voice message | :mag: **Fact-checking** — Google Fact Check API + DuckDuckGo, returns verdict with sources |
| :frame_with_picture: **Image deepfake** — dual detector (Reality Defender + Sightengine) with composite scoring | :link: **URL scanning** — paste a YouTube/TikTok/Twitter/Instagram link, bot downloads and analyzes |
| :movie_camera: **Video deepfake** — temporal inconsistency, Laplacian variance, edge density via OpenCV | :rotating_light: **Forwarded message detection** — warns about viral / highly-forwarded content |
| :chart_with_upwards_trend: **Frame heatmap** — visual PNG showing per-frame suspicion scores (green→red) | :robot: **Group auto-monitoring** — silently watches group chats, alerts only on suspicious content |
| :white_check_mark: **Authenticity certificate** — SHA-256 badge PNG for verified real content | :shield: **Rate limiting** — per-JID sliding window (5/hr · 15/day) |

---

## Three steps

1. **Send** — drop any media or paste a URL into WhatsApp (DM or group)
2. **Analyze** — Veritas routes it through the appropriate detection pipeline, usually in under 10 s
3. **Verdict** — you get a plain-language result, confidence score, and (for video) a frame heatmap or authenticity certificate

---

## Architecture

```
WhatsApp
  │  (Baileys WebSocket)
  ▼
Node 22 Server
  ├── Fastify HTTP API  (/v1/wa/*, /health)
  └── LangGraph Agent
        ├── Tool: detect_deepfake_audio  ──► Reality Defender API
        ├── Tool: detect_deepfake_image  ──► Reality Defender + Sightengine
        ├── Tool: detect_deepfake_video  ──► HF Space FastAPI (Python / OpenCV)
        ├── Tool: fact_check             ──► Google Fact Check + DuckDuckGo
        ├── Tool: scan_url               ──► yt-dlp download → video pipeline
        └── Tool: generate_certificate   ──► sharp (PNG badge)

PostgreSQL (Drizzle ORM)
  ├── conversations / messages
  ├── agent_runs / tool_calls
  └── message_dedup (restart-safe)

Next.js Dashboard  (KPI cards · tier badges · run explorer)
```

---

## ML service endpoints

The live Python sidecar runs at `https://dr4k3n-deepfake-detector.hf.space`.

```bash
# Liveness
curl https://dr4k3n-deepfake-detector.hf.space/health

# Analyze video from URL
curl -X POST https://dr4k3n-deepfake-detector.hf.space/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=..."}'

# Analyze with frame-level heatmap
curl -X POST https://dr4k3n-deepfake-detector.hf.space/analyze-visual \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=..."}' \
  --output heatmap.png
```

---

## Visual outputs

**Frame heatmap** — generated at runtime for every video analysis:

![Frame heatmap](docs/images/heatmap-placeholder.png)

_Each bar represents one sampled frame; color encodes suspicion (green = clean, red = manipulated)._

**Authenticity certificate** — issued when content passes all checks:

![Certificate](docs/images/certificate-placeholder.png)

_Includes SHA-256 hash of the original file, timestamp, and detector versions._

---

## Tech stack

| Layer | Technology |
|---|---|
| **Transport** | [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web multi-device) |
| **Agent** | [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) — stateful tool-calling loop |
| **LLM** | OpenAI / Anthropic / MiniMax — swappable via `agent.config.yaml` |
| **Detection** | Reality Defender SDK · Sightengine · OpenCV · HF Spaces (FastAPI + Python 3.12) |
| **Storage** | PostgreSQL 18 via [Drizzle ORM](https://orm.drizzle.team/) |
| **Frontend** | Next.js 15 dashboard with KPI cards and tier badges |
| **DevOps** | GitHub Actions CI with Postgres service container |

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/yripper/indies-hackathon.git
cd indies-hackathon
pnpm install

# 2. Start Postgres
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env
# Edit .env: add your LLM key, Reality Defender key, Sightengine credentials
# Generate a session key:
openssl rand -hex 32   # paste as WA_SESSION_KEY in .env

# 4. Run migrations
pnpm db:migrate

# 5. Start the bot
pnpm dev

# 6. Pair WhatsApp
curl -X POST http://localhost:3000/v1/wa/connect | jq
# Scan the returned QR code from WhatsApp → Settings → Linked devices
```

---

## Team

Built at **hack@latam 2026** by the Veritas team.

GitHub: [yripper/indies-hackathon](https://github.com/yripper/indies-hackathon)
