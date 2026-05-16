# Roadmap — Deepfake Detection Releases (Audio + Image)

Plan de trabajo para el dev que va a llevar las dos detecciones al release sobre la base de `k2` (main).

---

## Contexto rápido del repo

| Rama | Estado | Qué tiene |
|---|---|---|
| `k2` (main) | ✅ Estable | Agente WhatsApp limpio (Baileys + LangGraph), provider configurable, tools genéricos, sin detección. Instrucciones en `README.md`. |
| `feat/audio-deepfake-detection` | ✅ Funciona end-to-end | Detección de audio con Reality Defender SDK + dashboard Next.js + tabla `audio_analyses`. |
| `feat/image-detection-v2` | 🟡 Funciona en el camino feliz, falla en bordes | Detección de imágenes con Reality Defender + Sightengine (segundo dictamen). Procesa la mayoría pero hay regresiones y falta cobertura. |
| `feat/image-detection-tools` | 🔁 Histórico/exploratorio | Variante anterior con HuggingFace inference. **No usar como base** — quedó superada por v2. |

Reality Defender (API key gratis): **50 análisis/mes total entre audio e imagen**. Video sólo en el plan pago (399 USD/mes) — fuera de scope por ahora.

---

## Release 1 — Audio Deepfake Detection

Base recomendada: `feat/audio-deepfake-detection` directo a `k2`.

### Lo que ya está hecho en la rama (no tocar salvo lo de abajo)
- `src/integrations/reality-defender.ts` — wrapper del SDK, escribe el buffer a un tmpdir porque RD no soporta buffers in-memory.
- `src/agent/tools/analyze-audio-deepfake.ts` — tool sin args, lee el audio pendiente desde `AsyncLocalStorage`, mensaje de progreso "🔍 Analizando audio..." antes de la llamada (~7-10s).
- `src/transport/audio-cache.ts` — caché en memoria con `peek` / `take` (consume-on-read).
- `src/transport/baileys/connect-client.ts` — detecta `audioMessage` (directo y citado) + debounce 1500ms para mergear con el follow-up de texto.
- `src/transport/message-router.ts` — cola por JID para que la imagen/audio + el texto follow-up no compitan por el cache.
- `agent.config.yaml` — system prompt "Veritas" con los 4 casos de decisión.
- Schema: `audio_analyses` (tier + score + per-model + metadata) y queries en `src/db/queries/audio-analyses.ts`.
- Dashboard Next.js bajo `dashboard/` con KPI cards, conversaciones, tier badges.
- Endpoints `/api/analytics/*` en `src/api/analytics.ts`.
- Migración `drizzle/0001_hot_kingpin.sql`.

### TODOs antes de mergear a `k2`
- [ ] **Rebase / merge limpio con `k2`**. `k2` avanzó (MiniMax, instrucciones de tools en el README) — resolver conflictos en `agent.config.yaml`, `src/agent/graph.ts`, `src/transport/message-router.ts`.
- [ ] **Renombrar la migración**: `drizzle/0001_hot_kingpin.sql` → algo descriptivo (`0001_audio_analyses.sql`). Regenerar el snapshot.
- [ ] **README**: agregar sección "Audio deepfake detection" con el flag de `REALITY_DEFENDER_API_KEY` en `.env`, cómo activar la tool en `agent.config.yaml`, y cómo correr el dashboard (`cd dashboard && pnpm dev`).
- [ ] **Manejo del límite de 50/mes**: hoy si la API devuelve 429 / quota error el tool propaga el mensaje crudo. Capturar el caso y devolver un texto amigable en español ("Se acabó la cuota mensual del detector, intenta el mes que viene").
- [ ] **Tests**: la rama no trae test del tool de audio. Agregar al menos un test unitario con `reality-defender` mockeado para los tres tiers (real / uncertain / fake) y para el caso "no pending audio".
- [ ] **Logs**: revisar nivel de los `console.log` con prefijo `[tool:analyze_audio]` — pasarlos al logger de Fastify (`input.log.info`) como ya está parcialmente hecho en image v2.

### Criterios de aceptación
- Usuario manda audio → bot pregunta "¿querés que lo analice?" → usuario dice "sí" → veredicto en <15s.
- Usuario manda audio + texto "¿es real?" en la misma ventana de 1.5s → un solo veredicto, no doble respuesta.
- Tabla `audio_analyses` se popula con tier/score/modelos.
- Dashboard `/` muestra el último audio analizado.

---

## Release 2 — Image Deepfake Detection

Base: `feat/image-detection-v2` (después de mergear Release 1 a `k2`). La rama vieja `feat/image-deepfake-detection` está rota — ignorarla, **v2 la reemplaza**.

### Por qué v2 es la base correcta (no la rama vieja)
v2 **detecta más deepfakes reales** que cualquier acercamiento single-detector que probamos antes. La razón está documentada en el comentario de `analyze-image-deepfake.ts:28-41`: el ensemble de Reality Defender promedia 10 sub-modelos y diluye señales fuertes individuales — en pruebas vimos `rd-pine-img` disparando a 0.99 y `rd-elm-img` a 0.86 sobre una imagen claramente generada por IA, pero el ensemble lo amortiguó a 0.48 ("uncertain"). v2 arregla eso combinando tres señales:

- **RD ensemble** (promedio de 10 modelos, conservador).
- **El sub-modelo más alto de RD × 0.85** (rescata los casos donde un modelo individual tiene certeza pero el resto lo diluye).
- **Sightengine `genai`** — entrenado específicamente para los generadores modernos (Flux, MidJourney, GPT-image, Imagen, SD, DALL·E, Firefly, Ideogram) que RD subdetecta.

El score final es el `max()` de los tres. Resultado: una imagen Flux que la rama vieja marcaba "uncertain" con 48% ahora sale "fake" con ≥90%. Esto es la mejora de efectividad central del release — **conservar el composite score y los dos detectores tal como están**.

### Lo que ya está hecho en v2
- `src/integrations/reality-defender.ts` extendido con `analyzeImage` (mismo SDK, distinto extension routing por mime).
- `src/integrations/sightengine.ts` — segundo detector (REST multipart, modelos `genai` + `deepfake`). Free tier 2000 ops/mes. Calibrado para Flux/MJ/GPT-image/Imagen/SD/DALL·E/Firefly/Ideogram.
- `src/agent/tools/analyze-image-deepfake.ts` — corre los dos detectores en paralelo con `Promise.allSettled`. RD failure = fatal; Sightengine failure = soft (se guarda el error pero el veredicto sale).
- `agent.image-bot.yaml` — vertical separado, system prompt en chileno con los 5 casos de decisión y restricciones (nunca decir "definitivamente falso/real").
- `src/transport/image-cache.ts` (renombrado desde audio-cache) + dedup de `m.key.id` en `connect-client.ts` (Baileys reentrega el mismo mensaje cuando hay varios devices pareados).
- Soporte para **grupos en modo image-only** (texto en grupos se descarta).
- Schema `image_analyses` con campo extra `secondary_detector jsonb` para la respuesta de Sightengine. Migración `drizzle/0001_image_analyses.sql` + `0002_image_analyses_secondary.sql`.

### TODOs (en orden de prioridad)

#### 🔴 Bloqueantes — la rama está rota en estos casos

1. **Convivencia con audio**. v2 *eliminó* el código de audio para simplificar. Después de mergear Release 1 a `k2`, hay que re-introducir audio en v2:
   - Restaurar `src/transport/audio-cache.ts`, `src/agent/tools/analyze-audio-deepfake.ts`, `src/db/queries/audio-analyses.ts`, schema `audio_analyses`.
   - En `connect-client.ts`: detectar **ambos** tipos (`audioMessage` y `imageMessage`) en el mismo handler, con su respectivo debounce.
   - El sistema prompt debe poder hablar de los dos. Dos opciones: (a) un único agente con ambos tools y prompt unificado, o (b) router por tipo de media. Recomendación: **opción (a)** — un solo bot "Veritas" que detecta lo que el usuario manda.

2. **Migraciones desordenadas**. v2 reusó el slot `0001` para imagen porque la rama audio no había mergeado. Cuando audio entra primero a `k2`, hay que re-numerar:
   - audio = `0001_audio_analyses.sql`
   - imagen = `0002_image_analyses.sql`
   - imagen secondary detector = `0003_image_analyses_secondary.sql` (o fold en `0002`).
   - Regenerar `drizzle/meta/_journal.json` y los snapshots.

3. **Imágenes que "a veces no funcionan"**. Reproducir y arreglar. Casos sospechosos a probar:
   - HEIC desde iPhone (la función `extensionForImageMime` ya mapea pero RD puede rechazar el formato).
   - PNG con transparencia / WebP animado.
   - Imágenes pesadas (>5MB). Baileys descarga en buffer; ver si RD tiene cap de tamaño.
   - Imágenes citadas (`source: 'quoted'`) cuando el mensaje original ya no está en cache de Baileys.
   - Mensajes que vienen como `viewOnce` o `ephemeralMessage` (no se detectan hoy — `extractImage` sólo mira `imageMessage` directo y citado).
   Estrategia: agregar logging estructurado al fail-path y correr 20 imágenes variadas en staging.

#### 🟡 Importante — antes del release

4. **Recuperar el dashboard**. v2 borró el directorio `dashboard/` y `src/api/analytics.ts`. Recuperarlo desde `feat/audio-deepfake-detection` y adaptar las queries para que muestren `image_analyses` además de `audio_analyses`. El badge de "tier" y los KPI cards ya funcionan para ambos esquemas (mismas columnas `tier`/`score`/`created_at`).

5. **Manejo de cuota compartida (50/mes RD)**. Audio + imagen comparten la misma key. Capturar 429 / quota exceeded y devolver mensaje claro. Para imagen: si RD falla por cuota, **degradar a Sightengine sólo** (no abortar) y avisarlo en el detalle técnico. Sightengine tiene 2000 ops/mes propias y por sí solo ya supera al RD-único de la rama vieja en efectividad sobre generadores modernos — es un fallback aceptable, no una degradación dura.

6. **README de imagen**. Agregar:
   - Variables `SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET` (cómo registrarse).
   - Explicación de los thresholds (FAKE ≥ 0.8, UNCERTAIN 0.4–0.8) y el por qué del composite score.
   - Cómo cambiar entre `agent.config.yaml` (Veritas / audio) y `agent.image-bot.yaml` (image-bot) — ya documentado en commit `5165469`, copiar.

#### 🟢 Nice-to-have

7. **Tests de integración**. Mockear RD + Sightengine y probar las 3×3 combinaciones de tier (RD fake/uncertain/real × SE fake/uncertain/real) para verificar que `composite()` y `tierFromScore()` se comportan como se espera.
8. **Rate limiting por JID**. Hoy nada impide a un usuario quemar la cuota mensual con un script. Cap de N análisis por JID por hora.
9. **Persistencia del `m.key.id` dedup set**. Hoy es un `Set` en memoria de 1000 entries; sobrevive a reinicios cero. Si vemos reentregas después de restart, mover a Redis o a la tabla `messages`.

### Criterios de aceptación
- Imagen generada por IA (probar con MidJourney/Flux/DALL·E) → tier `fake`, confianza ≥80%, mensaje con detalle técnico y recomendación de verificación por otro canal.
- Foto real de teléfono → tier `real`, confianza <40%.
- Zona gris → tier `uncertain` con mensaje "los detectores no se ponen de acuerdo".
- Imagen + caption "¿es real?" en un solo mensaje → veredicto inmediato sin pedir confirmación.
- Grupo con bot agregado → sólo responde a imágenes, ignora texto.
- HEIC, PNG, WebP, JPEG todos funcionan.

---

## Release 3 — Video (deferred)

**No lo abordamos por ahora.** Reality Defender cobra 399 USD/mes para video. Alternativas a investigar antes de comprometerse:
- Sightengine también ofrece detección de video, free tier separado. Vale la pena spike de 1 día para evaluar precisión.
- Sampling frames del video + correr el pipeline de imagen sobre N frames. Hack viable para una demo, no producción.
- Si decidimos pagar RD video: gating de feature por env var, mismo patrón que image.

Crear ticket aparte cuando llegue el momento.

---

## Cross-cutting / housekeeping

- **Provider LLM**: `k2` está en MiniMax-M2. Ambos verticales (audio/Veritas e image-bot) ya están configurados para MiniMax con `temperature: 0.2` — no cambiar al mergear.
- **`AsyncLocalStorage` en `src/agent/context.ts`**: es el mecanismo por el que el tool sabe qué JID y qué recorder usar. No tocar sin entender — el message-router lo envuelve con `withConversation`.
- **No dejar `console.log` con prefijos `[tool:...]`** en el código final. Migrar todo a `input.log` (Fastify pino). v2 ya empezó la migración, terminar.
- **Secrets en `.env.example`**: documentar todas las nuevas keys con link al signup. Nunca hardcodear.

---

## Sugerencia de orden de merges

```
k2  ←  feat/audio-deepfake-detection         (Release 1)
k2  ←  feat/image-detection-v2 (rebased)     (Release 2, después de re-introducir audio)
```

Hacer cada merge con PR y review. No squashear — los commits de v2 cuentan una historia de debugging que es útil leer (race conditions de Baileys, redelivery dedup, MiniMax rechazando tool_call_ids huérfanos).
