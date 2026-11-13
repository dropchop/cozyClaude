# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agent Valley** (a.k.a. Agent Pipeline Builder) is a locally hosted, gamified web UI for
building and running **real** multi-agent LLM pipelines, skinned as a Stardew-Valley pixel
town. A **pipeline is a neighborhood**, a **station is a house** with an LLM agent inside, and
**connections are pneumatic tubes** defining data flow. Houses execute in topological order;
each agent's text output is fed to its downstream agents.

The cozy UI is a thin skin over a real orchestration backend (DAG execution, streaming, cost
metering). `README.md` is kept current and is the best prose reference for *what* the app does
and *why* PGlite/Phaser were chosen — this file covers *how the code fits together*.

## Commands

```bash
./dev.sh                 # DEV: installs deps, seeds on first run, runs backend (node --watch)
                         #   + Vite together. → UI http://localhost:5173, API :4000
MOCK_LLM=1 ./dev.sh      # same, but agents echo a deterministic mock instead of calling an LLM
./run.sh                 # PROD: builds the UI, backend serves API+WS+static UI on ONE port (:4000)

# Backend tests (clean-exit, no external services — always run with MOCK_LLM where applicable):
cd backend
npm run test:smoke       # CRUD over a real socket + PGlite
npm run test:run         # full A→B→C / D→C orchestration: topo order, WS streaming, persistence
npm run test:cost        # cost-ceiling / budget math
npm run test:decor       # decorations CRUD + building-style persistence + cascade delete

# Frontend tests:
cd frontend
npm run test:phaser      # headless: geometry, texture coverage, NPC pathfinding/collision
node test/integration.mjs  # (in backend/) combined server: serves UI + API + runs a seeded pipeline
```

There is **no lint step and no test runner/framework** — tests are standalone `.mjs` scripts
that spin up a real server, assert, and exit non-zero on failure. Add new tests the same way.

## Environment / config

`backend/.env` (created from `.env.example` on first run). Key vars:

- `ANTHROPIC_API_KEY` — required for real runs (default provider). Without it, runs fail unless `MOCK_LLM=1`.
- `OPENAI_API_KEY` / `GOOGLE_API_KEY` — only needed when a custom model uses those providers.
- `MOCK_LLM=1` — offline mode; `runAgent` returns a zero-cost echo (works without any keys).
- `DEFAULT_MODEL` (default `claude-sonnet-4-6`) — model for stations with a NULL model field.
- `MAX_RUN_COST_USD` (default `1.0`), `MAX_INPUT_CHARS` (default `40000`) — per-run safety ceilings.
- `MAX_MAIL_DEPTH` (default `3`) — max post-office → post-office relay hops before mail delivery is refused (the cross-town loop guard).
- `PORT` (default `4000`), `PGLITE_DIR` (default `backend/data/pgdata`).

## Architecture

### Backend (Node, ESM, Express) — `backend/src/`

- **`server.js`** — Express + `http.Server` + WS. In prod, serves `frontend/dist` with an SPA
  fallback for any non-`/api/` GET. `initDb()` runs before `listen`.
- **`db.js`** — PGlite (embedded PostgreSQL 16 / WASM, persists to `data/pgdata`). Exports
  `query(sql, params) → rows` and `one(sql, params) → row|null`. Single in-process connection.
- **`schema.sql`** — applied on every boot. Uses `CREATE TABLE IF NOT EXISTS` **plus**
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for forward-migrations — **add new columns this way**
  so existing on-disk databases upgrade idempotently (there are no migration files).
- **`orchestrator.js`** — the core. `startRun` claims a per-pipeline slot (`activeRuns` Set) to
  prevent double-runs (the `add`-immediately-after-`has` ordering is a deliberate TOCTOU fix —
  don't reorder it), inserts a `runs` row, returns immediately, then `executeRun` runs the DAG
  in the background. Builds the graph, Kahn topological sort (fails the run on a cycle),
  executes stations in order. Multi-upstream stations get all parent outputs concatenated with
  `=== Output from "<name>" ===` headers; roots get the kickoff input. **Cost is projected
  *before* each call** (`maxOutputTokensForBudget`) and the run is failed if the ceiling would
  be crossed — every step also re-checks cumulative cost after.
  **Post offices**: a `stations.type='post_office'` station doesn't call an LLM — it forwards
  its gathered input ("mail") to the hub named by `send_to_post_office_id` via `deliverMail`,
  which fires a fresh `startRun` on that hub's town seeded at its `mail_distributions` targets
  (fire-and-forget — only the run's *creation* is awaited). `executeRun` takes
  `opts.{entryStations, entryInput, mailDepth}`: with entries it runs only the sub-DAG
  reachable from them, seeding each entry with the mail (edges *into* an entry are dropped so
  it's a root). `MAX_MAIL_DEPTH` + the per-pipeline run lock bound loops; delivery problems
  (busy/missing/looping) become a receipt artifact on the post office's step, never a failure.
- **`providers/`** — model/provider abstraction:
  - `index.js` — `resolveModel(field)` turns a `stations.model` value (built-in name | a
    `custom_models` UUID | null) into a uniform record, **falling back to `DEFAULT_MODEL`**
    rather than throwing when a model is missing/deleted. `runAgent(...)` lazy-loads the
    provider module and (if `MOCK_LLM`) short-circuits to an echo. `estimateCost` prices input/
    output/cache buckets separately. Built-in Anthropic models + prices live in `anthropic.js`.
  - `anthropic.js` (always loaded), `openai.js`, `google.js` (lazy; their SDKs are
    `optionalDependencies`). Each exports a `run({system, input, modelId, apiKey, baseUrl,
    maxTokens, supportsThinking, onText})` that streams and returns `{text, usage, model}`.
- **`ws.js`** — `broadcast(event, data)` hub. The orchestrator pushes `run_update`,
  `run_step_update`, and (live token-by-token) `run_step_token`.
- **`routes/api.js`** — all REST endpoints (see README "API surface" table + `/api/models`
  GET/POST/DELETE for the custom-model registry, and `/decorations/bulk` for dragged-out roads).
  Errors flow through the `wrap()` helper; throw an `Error` with a `.status` to return a 4xx.

**Data model** (`schema.sql`): `pipelines → stations / connections / decorations / runs`,
`runs → run_steps → artifacts`, plus standalone `custom_models`. Cross-town mail adds
`stations.type` + `stations.send_to_post_office_id` and a `mail_distributions`
(`post_office_station_id → target_station_id`) table — kept out of `connections` so it never
joins a town's run DAG. Everything cascades on delete.
`decorations` and `stations.style` are **purely cosmetic** — never part of the agent data flow.
Secrets are **never** stored in `custom_models`; API keys live only in env vars per provider.

### Frontend (React 18 + Vite) — `frontend/src/`

- **Single rendering engine: Phaser.** `main.jsx` mounts `PhaserApp.jsx` (the React HUD), which
  mounts the Phaser canvas via `TownCanvas.jsx`. (StrictMode is intentionally omitted — it would
  double-boot the Phaser game.) An older React Flow canvas (`?engine=reactflow`, `@xyflow/react`)
  was removed once Phaser was confirmed in real use — treat any reintroduced `@xyflow`/React Flow
  code as dead.
- **`phaser/`** — the Phaser 4 town:
  - `TownScene.js` — the scene: sprites, camera, particles, drag/wire interaction, build grid.
  - `textures.js` — procedural pixel-art texture generation. `geometry.js` — layout math.
  - `pathfinding.js` — NPC routing (pathfinding.js lib). `bus.js` — see below.
- **`phaser/bus.js`** — a tiny event bus is the **only** bridge between the React HUD and the
  Phaser scene. React→scene: `load`, `build:mode`, `brush`, `lineMode`, `runState`, …
  scene→React: `selectHouse`, `placeDecor`, `moveNode`, `deleteDecor`, `connect`, `error`, …
  When wiring new canvas↔HUD behavior, add an event here rather than reaching across.
- React owns the chrome: `Inspector.jsx` (house name/model/prompt/style + artifact view; a
  building-type toggle turns a house into a 📮 post office, swapping the model/prompt fields
  for a sends-to picker + a distribution checklist),
  `AddModelDialog.jsx` (custom-model registry UI), `BuildPalette.jsx`, `useWebSocket.js`
  (live updates), `api.js` (REST client).

### Build mode (Sims-style decorating)

`buildMode` is a scene flag toggled via the `build:mode` bus event. **All mutating canvas
edits are gated behind it** — dragging houses/decorations, creating wires, and `deleteSelected`
all bail when `buildMode` is false (see `TownScene.js`). Click-*to-select* stays live outside
build mode so houses remain inspectable. Preserve this gating when adding new edit interactions.

## Conventions / gotchas

- **ESM everywhere**, `"type": "module"`. Backend uses `node --watch` in dev — new routes
  hot-reload, no restart needed.
- **Schema changes** = append an idempotent `ALTER TABLE … IF NOT EXISTS` to `schema.sql`
  (no migration tooling).
- **Tests are real-server scripts**, not a framework. Run backend tests with `MOCK_LLM` so they
  never spend tokens or need keys.
- **Sandbox note** (from prior sessions): the Bash sandbox kills persistent servers and discards
  writes under the project dir — test via clean-exit scripts (the existing `test/*.mjs` pattern)
  rather than leaving a server running.
- The parent directory's `/home/micah/ClaudesWorld/CLAUDE.md` documents a *different* project
  (a Python webcam app) — ignore it; this repo is self-contained.
