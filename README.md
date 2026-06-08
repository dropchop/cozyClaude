# 🌻 Agent Pipeline Builder — "Agent Valley"

A locally hosted, gamified web UI for building and running **real** AI agent pipelines,
styled as a cozy **Stardew-Valley pixel town**. A **pipeline is a neighborhood** you
establish; each **station is a house** with a real LLM agent inside. Connect houses with
**pneumatic tubes** (the old bank-style kind) to define data flow, press **Start the Day**,
and watch brass carriers shoot through the tubes while houses light their windows and puff
chimney smoke. Little **townsfolk** wander the meadow among trees and flowers while you build.

The pixel-valley UI is a skin over a real orchestration backend, with a 🔨 **build mode**
(Sims-style) for decorating your town: place and move trees, roads, fountains, lamps, fences,
crops and more, and pick a **building style** for each house (cottage / shop / tower / barn /
bakery / cabin). Decorations and styles are saved on the server, so a town looks the same on
every device.

```
[React + React Flow UI]  ⇄ HTTP + WebSocket ⇄  [Node + Express backend]  ⇄  [PGlite / Postgres]
   canvas, wires,                                 REST API, orchestrator,        persistent
   live run view                                  WebSocket hub                  pipelines/runs/artifacts
                                                          ⇩
                                                   [Claude API]  (claude-opus-4-8, adaptive thinking, streaming)
```

## Quick start

**One button (recommended) — `./dev.sh`.** Installs deps, seeds an example on first run,
and starts the backend **and** UI together with hot-reload (the backend uses `node --watch`,
so code changes — like new API routes — pick up automatically; no more stale-server 404s):

```bash
./dev.sh
# → open http://localhost:5173   (Ctrl-C stops everything)
```

Set your Anthropic key in `backend/.env` (`./dev.sh` creates it from the template on first
run — add `ANTHROPIC_API_KEY=sk-ant-...`). **No key yet?** Start in offline mock mode — stations
stream a deterministic mock response instead of calling Claude:

```bash
MOCK_LLM=1 ./dev.sh
```

### Production single-port launch — `./run.sh`

For an always-on deployment, `./run.sh` builds the UI and serves the whole app (API +
WebSocket + UI) from the backend on one port:

```bash
./run.sh
# → open http://localhost:4000
```

## Using it

1. **+ Neighborhood** — establish a new neighborhood (a pipeline).
2. **+ House** — drop an agent's house on the meadow. Click it to set its **name**, **model**,
   and **system prompt** (its role) in the inspector.
3. **Lay pneumatic tubes** — drag from a house's right fitting to another's left fitting.
   Output of the upstream house is carried to the downstream one.
4. **Type the day's task** at the bottom and press **▶ Start the Day**.
5. Watch carriers shoot through the tubes; houses turn amber (working) → green (done),
   streaming their output live. Click any house to read its full artifact.

Houses run in **topological order**. A house with several incoming tubes receives all
upstream outputs concatenated. Roots (no incoming tube) receive the day's kickoff input.

### Build mode (decorating)

Press **🔨 BUILD** — a building grid appears (it's hidden in normal play). Pick an item
(Paths & Water / Nature / Town), then **click or drag on the meadow to build**; tiles snap to the
grid. With a build item selected, click-drag builds instead of panning, so to **move your view
hold Space and drag** (or pinch on touch). Tools:

- **Roads & paths drag out a line.** Hold and drag to rubber-band a line; a translucent **preview**
  shows where it lands, and it commits on release. A **L-shaped ⟷ Straight** toggle (shown when a
  road/path is selected) switches between corner-routing and a single straight run.
- **🚜 Bulldoze** removes decorations — click or drag over them to clear a swath. (Houses are
  removed from the house inspector, so you can't bulldoze an agent by accident.)
- **🖐 Move / Select** returns to normal drag-to-pan; drag decorations to reposition, select +
  Delete to remove.

Everything you place is saved to the server per-neighborhood. Pick a **building style** for any
house from its inspector; the house re-skins instantly.

**Townsfolk** favor walking on roads and paths and stay close to your buildings and decorations.
Each placed object contributes a small radius of "walkable" tiles to a lightweight map the
villagers wander; lay some paths and they'll stroll along them.

## Tech

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React HUD + [Phaser 4](https://phaser.io) game canvas | the town renders in a Phaser scene (sprites, camera, particles, pathfinding NPCs); React owns the menus/inspector/run bar. Pathfinding via [pathfinding.js](https://www.npmjs.com/package/pathfinding). The old React Flow canvas is kept as a fallback at `?engine=reactflow`. |
| Real-time | WebSocket | pushes `run_step_update` / `run_step_token` / `run_update` to the UI |
| Backend | Node + Express | REST API + orchestrator + WS hub |
| Database | **PGlite** (`@electric-sql/pglite`) | embedded PostgreSQL (WASM), persists to `backend/data/`. Same SQL dialect as a real Postgres server — see note below |
| LLM | Claude API | `claude-opus-4-8` default, adaptive thinking, streamed responses |

### Why PGlite instead of a Postgres server?

The spec calls for PostgreSQL. PGlite **is** PostgreSQL 16 compiled to WASM, running
embedded in the Node process and persisting to disk — so `gen_random_uuid()`, `UUID`,
`TIMESTAMPTZ`, and `NUMERIC` all work and the schema in `backend/src/schema.sql` is
unchanged. This keeps the app a single self-hosted process with **zero external
services** (no Docker, no `psql`, no `sudo`). To move to a standalone Postgres server
later, swap `backend/src/db.js` for a `pg` Pool — the SQL is portable as-is.

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | liveness |
| `GET` | `/api/models` | allowed models + default |
| `GET/POST` | `/api/pipelines` | list / create pipelines |
| `GET/PATCH/DELETE` | `/api/pipelines/:id` | full graph (pipeline + stations + connections) / update / delete |
| `POST` | `/api/pipelines/:id/stations` | add a station |
| `PATCH/DELETE` | `/api/stations/:id` | edit (prompt, model, position) / delete |
| `POST` | `/api/pipelines/:id/connections` | lay a pneumatic tube |
| `DELETE` | `/api/connections/:id` | remove a tube |
| `GET/POST` | `/api/pipelines/:id/decorations` | list / place a decoration |
| `PATCH/DELETE` | `/api/decorations/:id` | move / remove a decoration |
| `POST` | `/api/pipelines/:id/run` | start a run (returns immediately; progress over WS) |
| `GET` | `/api/pipelines/:id/runs` | run history |
| `GET` | `/api/runs/:id` | full run detail: steps + artifacts |

WebSocket at `ws://<host>/ws` emits:

```jsonc
{ "event": "run_step_update", "data": { "run_id", "station_id", "status", "tokens_used", "cost_usd", "artifact" } }
{ "event": "run_step_token",  "data": { "run_id", "station_id", "delta" } }   // live streaming
{ "event": "run_update",      "data": { "run_id", "status" } }
```

## Tests

The backend ships clean-exit integration tests (no external services, run with `MOCK_LLM`):

```bash
cd backend
npm run test:smoke   # CRUD over a real socket + PGlite
npm run test:run     # full A→B→C / D→C orchestration, topo order, WS streaming, persistence
npm run test:decor   # decorations CRUD + building-style persistence + cascade delete

cd ../frontend
npm run test:phaser  # headless: geometry, texture coverage, NPC pathfinding/collision
node test/integration.mjs   # combined server: serves UI + API + runs a seeded pipeline
```

## Project layout

```
backend/
  src/
    server.js        Express + WS + static UI host
    db.js            PGlite init + query helpers
    schema.sql       the database schema
    anthropic.js     Claude integration (streaming, cost, MOCK_LLM)
    orchestrator.js  DAG topological execution + WS progress
    ws.js            WebSocket broadcast hub
    routes/api.js    REST API
    seed.mjs         example "Blog Post Factory" pipeline
  test/              smoke / run / integration tests
frontend/
  src/
    App.jsx          canvas, wiring, run controls, inspector, build mode
    StationNode.jsx  the cozy house node (per-style building)
    DecorNode.jsx    placed decoration node
    Sprites.jsx      decoration sprite library + build palette catalog
    BuildPreview.jsx translucent ghost line while dragging a road/path
    world.js         tile helpers + NPC walkmap (per-object walkable radius)
    PneumaticTube.jsx custom tube edge with travelling carriers
    TownLayer.jsx    path-favoring townsfolk overlay
    Villager.jsx     pixel townsperson sprite
    useWebSocket.js  live-update hook
    api.js           REST client
    styles.css       SNES pixel-town theme
dev.sh               one button: hot-reloading backend + UI together (dev)
run.sh               install + build + seed + launch on one port (production)
```

## Scope (v1)

Matches the spec's v1 limits: manual routing only (no agent-decided routing), text
artifacts only (tool use is a future upgrade), single-user (Tailscale handles access),
full response before passing forward (no token-by-token piping between stations — though
tokens *are* streamed live to the UI). Future upgrades: tool use, conditional wires,
station templates, cost dashboard, pipeline export.
