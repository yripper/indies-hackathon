# Roadmap — Veritas Deepfake Detection

Estado actual del proyecto al 2026-05-16.

---

## Releases completados

### Release 1 — Audio Deepfake Detection ✅
- Reality Defender SDK (50 scans/month free tier)
- Quota handling (QuotaExhaustedError → friendly Spanish message)
- Pino structured logging
- 5 unit tests (mock-based)
- Migration: `0001_audio_analyses.sql`

### Release 2 — Image Deepfake Detection ✅  
- Reality Defender + Sightengine dual-detector (parallel via Promise.allSettled)
- Composite scoring: `max(RD ensemble, RD top sub-model × 0.85, SE genai)`
- Graceful degradation: if RD quota exhausted, continues with Sightengine-only
- 10 unit tests covering 3×3 RD×SE combinations
- Migration: `0002_image_analyses.sql`

### Release 3 — Video Deepfake Detection ✅
- Python ML service (FastAPI + MTCNN + EfficientNetB0)
- Temporal inconsistency analysis across frames
- Deployed to HF Spaces: https://dr4k3n-deepfake-detector.hf.space
- 6 unit tests
- No API cost (local model, free unlimited)

---

## Features adicionales completados

- **Rate limiting por JID**: 5 análisis/hora, 15/día (sliding window in-memory)
- **Dashboard**: API analytics combinada (audio + imagen) + Next.js UI con badges por tipo de media
- **Message dedup**: Set de message IDs (cap 1000) para evitar redelivery de Baileys
- **Audio/Image cache**: peek/take pattern, 10min TTL, per-JID isolation

---

## PRs pendientes de merge

| PR | Branch | Target | Contenido |
|---|---|---|---|
| Audio + Image + Rate Limit + Dashboard | `release/image-to-k2` | `k2` | Todo R1 + R2 + extras |
| Video Detection | `feat/video-deepfake-detection` | `k2` | R3 (Python service + Node tool) |

Merge order: `release/image-to-k2` first (larger), then `feat/video-deepfake-detection`.

---

## Nice-to-have (backlog)

- [ ] Persistencia del dedup set (Redis/DB para sobrevivir reinicios)
- [ ] Soporte viewOnce / ephemeralMessage
- [ ] HEIC testing exhaustivo (iPhone → RD compatibility)
- [ ] Imágenes >5MB handling
- [ ] Video: GPU inference para mejor latencia (actualmente CPU ~20-30s)

---

## Arquitectura

| Component | Location |
|---|---|
| Audio tool | `src/agent/tools/analyze-audio-deepfake.ts` |
| Image tool | `src/agent/tools/analyze-image-deepfake.ts` |
| Video tool | `src/agent/tools/detect-deepfake-video.ts` |
| Reality Defender wrapper | `src/integrations/reality-defender.ts` |
| Sightengine wrapper | `src/integrations/sightengine.ts` |
| Rate limiter | `src/rate-limit/analysis-limiter.ts` |
| Audio cache | `src/transport/audio-cache.ts` |
| Image cache | `src/transport/image-cache.ts` |
| Python ML service | `deepfake-service/` |
| Dashboard | `dashboard/` (Next.js 16) |
| Analytics API | `src/api/analytics.ts` |

## External APIs

| Service | Free Tier | Used For |
|---|---|---|
| Reality Defender | 50 scans/month | Audio + Image |
| Sightengine | 2000 ops/month | Image (genai + deepfake) |
| Video ML | Unlimited (local) | Video frame analysis |
