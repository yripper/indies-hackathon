# :shield: VERO

> **Defensa ciudadana de WhatsApp contra fraude por IA** — si algo te hace dudar, lo reenvías a Vero. Verifica audios, imágenes, videos y enlaces sospechosos en segundos, y te entrega un semáforo claro con los pasos concretos para actuar. Sin app, sin registro, para cualquier persona.

[![Node 22](https://img.shields.io/badge/node-22-brightgreen?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![HF Space](https://img.shields.io/badge/HF%20Space-live-orange?logo=huggingface)](https://dr4k3n-deepfake-detector.hf.space)
[![CI](https://img.shields.io/github/actions/workflow/status/yripper/indies-hackathon/ci.yml?label=CI)](https://github.com/yripper/indies-hackathon/actions)

Built for **hack@latam 2026**.

---

## How it works

Funciona para cualquier persona que reciba contenido sospechoso por WhatsApp. Vero solo procesa lo que se le reenvía deliberadamente. En grupos, solo responde cuando se la menciona con `@`.

```
  1. Recibes          2. Reenvías           3. Vero verifica          4. Recibes
  algo dudoso   ───▶  a Vero por      ───▶  en segundos        ───▶   respuesta
  (audio /            WhatsApp              (autenticidad,             (semáforo +
  imagen /                                  contenido y                 pasos
  video / URL)                              hechos)                     concretos)
                                            │
                                            ▼
                                    Baileys Transport
                                            │
                                            ▼
                                    LangGraph Agent
                                            │
        ┌───────────────────────────────────┤
        │                                   │
        ├── Triple verificación (audio)     │
        │       1. Reality Defender ensemble  ── ¿voz sintética?
        │       2. Whisper transcribe         ── ¿qué dijo?
        │       3. Google Fact Check          ── ¿la afirmación es cierta?
        │
        ├── Imagen   → Reality Defender + Sightengine (identifica generador)
        ├── Video    → HF Space (OpenCV temporal + heatmap PNG)
        └── URL      → yt-dlp (YouTube / TikTok / X / IG) → pipeline de video

  Respuesta al usuario:
    🟩 / 🟨 / 🟥 + % de confianza
    + pasos concretos para actuar
    + canales oficiales (1212 / 134 / comisariavirtual.cl) en veredictos FALSO/INCIERTO
    + heatmap PNG (si es video)
    + certificado de autenticidad (si es real)
```

---

## Features

| Detección de medios | Comprensión, fact-check y seguridad |
|---|---|
| :microphone: **Audio deepfake** — Reality Defender ensemble (10 sub-modelos) en cada nota de voz reenviada | :memo: **Transcripción Whisper** — cada audio se transcribe automáticamente para alimentar el fact-check |
| :frame_with_picture: **Imagen deepfake** — Reality Defender + Sightengine en paralelo, identifica generador (DALL-E, Flux, Midjourney, SD) | :mag: **Fact-checking encadenado** — Google Fact Check API + DuckDuckGo, verdict con fuentes primarias |
| :movie_camera: **Video deepfake** — inconsistencia temporal, varianza Laplacian y densidad de bordes vía OpenCV en HF Spaces | :link: **Escaneo de URLs** — YouTube, TikTok, Twitter/X e Instagram; Vero descarga con yt-dlp y reusa el pipeline |
| :chart_with_upwards_trend: **Frame heatmap** — PNG verde→rojo por frame analizado | :lock: **Solo procesa lo reenviado** — Vero no escucha conversaciones, solo lo que se le manda deliberadamente |
| :white_check_mark: **Certificado de autenticidad** — PNG con hash SHA-256 + timestamp para contenido verificado como real | :busts_in_silhouette: **En grupos, solo con @mención** — Vero no responde en silencio; solo cuando alguien la nombra explícitamente |
| :traffic_light: **Semáforo de confianza** — 🟩 real / 🟨 incierto / 🟥 falso con % y razones | :telephone_receiver: **Canales oficiales en cada veredicto FALSO/INCIERTO** — 1212, 134, comisariavirtual.cl |
| :bar_chart: **Dashboard público** — KPIs y tendencias agregadas, sin login (`/v1/public/stats`) | :shield: **Rate limiting** — ventana deslizante por JID (5/hora · 15/día · 10/hora grupos · 3/5min URL scan) |

---

## Cómo se usa

1. **Recibes** un audio, imagen, video o enlace que te hace dudar
2. **Lo reenvías a Vero** por WhatsApp (chat directo o mencionándola con `@` en un grupo)
3. **Recibes la respuesta en segundos**: semáforo 🟩 / 🟨 / 🟥 con % de confianza, motivos del veredicto, y los canales oficiales para actuar si ya hubo daño (1212, 134, comisariavirtual.cl)

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

Built at **hack@latam 2026** by the Vero team.

GitHub: [yripper/indies-hackathon](https://github.com/yripper/indies-hackathon)
