# Code Review — cozyClaude

This is the review checklist for this repo. It overrides generic defaults: when the `/code-review` skill or a reviewer is weighing whether to flag something, the rules below take precedence. Read top-to-bottom in under two minutes.

cozyClaude is a Node + Express backend (PGlite, ws, Anthropic SDK) and a React + Phaser frontend, JavaScript-only. There is no linter, no TypeScript, no auth, no input-validation library, and minimal CI. The rules assume that baseline — don't flag the absence of those things in PRs that aren't trying to fix them.

## Always flag

- **Unhandled errors / missing error boundaries.** REST handlers must go through `wrap()` in [backend/src/routes/api.js](backend/src/routes/api.js); a raw `router.post('/x', async (req, res) => …)` without it leaks rejections. Background work spawned from `startRun()` in [backend/src/orchestrator.js](backend/src/orchestrator.js) must catch failure and surface it over the WebSocket, not swallow it. Flag any new `.then(...)` with no `.catch(...)` and any `await` inside a non-async function. React side: a top-level error boundary around `<App />` and `<PhaserApp />` so a Phaser scene crash doesn't blank the page.
- **Hardcoded secrets, credentials, or tokens.** `ANTHROPIC_API_KEY` is read in [backend/src/anthropic.js](backend/src/anthropic.js) and stays backend-only. Flag any import of it from `frontend/`, any literal `sk-ant-…` in source, any committed `backend/.env` (only `.env.example` belongs in git). Vite inlines anything named `VITE_*` into the client bundle — flag any new `VITE_*` name that smells like a credential rather than public config.
- **Missing input validation on external data.** There is no zod / joi here; the floor is manual checks, but a `if (!name)` alone is not enough for new endpoints. A new route or handler must validate **type** (string vs number vs array), **bounds** (system prompt length, name length, decoration array size), and **enum membership** (model id against the supported Claude models, decoration `kind` against the known set). Inbound WebSocket payloads in [backend/src/ws.js](backend/src/ws.js) currently have no validation layer — any new event handler that trusts client-supplied fields without a shape check is a flag.
- **Unsafe `eval()`, `innerHTML`, or equivalent injection vectors.** Today the repo is clean — no `eval`, `new Function`, or `dangerouslySetInnerHTML`. Flag any new instance, even in dev-only code. React JSX and Phaser text/sprite APIs are safe by default; reach for them, not raw DOM. SQL belongs in this bucket too: all PGlite queries in [backend/src/db.js](backend/src/db.js) and its callers must use parameter placeholders (`$1`, `$2`, …) — never template-literal interpolation of user input, even "just for an internal admin endpoint."
- **Async operations without error handling.** Specifically: streaming loops over `client.messages.stream()` in [backend/src/anthropic.js](backend/src/anthropic.js), the reconnect loop in [frontend/src/useWebSocket.js](frontend/src/useWebSocket.js), PGlite startup and migrations in [backend/src/db.js](backend/src/db.js), and any fire-and-forget `startRun(…)` whose rejection nobody is listening for.
- **Functions or modules with no clear single responsibility.** Flag when [backend/src/orchestrator.js](backend/src/orchestrator.js) grows a function that mixes run lifecycle + cost tracking + prompt assembly + WebSocket broadcasting. Flag when [frontend/src/phaser/TownScene.js](frontend/src/phaser/TownScene.js) grows a method that mixes rendering, pathfinding, build-mode placement, and bus glue. Split or extract before merging.
- **Dead code or commented-out blocks left in place.** The React Flow path served at `?engine=reactflow` is a live fallback — don't flag it as dead. Do flag commented-out logic blocks, unused imports, and references to features that no longer exist.
- **Dependencies added without a clear justification.** Every new npm dep needs a one-line PR reason. Be especially skeptical of: a second HTTP client beside `fetch`, a second state library beside React state + the Phaser bus, a validator library you're tempted to add without converting the existing handlers to use it, anything in the bundle that's only used by one feature flag.
- **TODO / FIXME that blocks correctness.** Flag a TODO that marks an unhandled error path, an unvalidated input, a known-wrong cost calculation, or a missing cleanup. Style TODOs are fine.

## Skip

- Style and formatting — there is no linter, but this still applies; don't reformat other people's code in review.
- Spelling in comments.
- Line length, unless it actually hurts readability.
- Generated and data artifacts: `frontend/dist/`, `backend/data/` (PGlite files), `node_modules/`, `package-lock.json`.
- Nitpicks that don't affect correctness, security, or maintainability.

## Severity guide

- **Bug** — will or likely will cause incorrect behavior at runtime. *Example: `startRun()` resolves before the stream finishes, so the cost tally written to the DB is wrong.*
- **Security** — could expose data or allow unauthorized access. *Example: a new endpoint echoes user-supplied HTML back into a server-rendered response, or a `VITE_` env var ships a secret into the client bundle.*
- **Risk** — correct now but fragile under foreseeable conditions. *Example: a new WebSocket event handler trusts `event.kind` without checking it's in the known set — works today, breaks the day a malformed client connects.*
- **Nit** — minor. Flag once per PR, don't repeat. *Example: inconsistent quote style in a new file.*

## cozyClaude-specific rules (additions to the generic list)

These don't appear in the generic checklist but are load-bearing here.

- **LLM cost cap must remain enforced.** Any code path that calls Claude must respect `MAX_RUN_COST_USD` and route through `runAgent()` in [backend/src/anthropic.js](backend/src/anthropic.js). A direct `client.messages.create()` or `client.messages.stream()` call that bypasses cost accounting is a **Bug**, not a Nit.
- **MOCK_LLM parity.** When `MOCK_LLM=1`, only the LLM call itself is stubbed — the orchestrator's control flow (queuing, cost tally, WebSocket events, DB writes) must run end-to-end. A mock that short-circuits the orchestrator hides bugs that only show up in production. Flag any new mock branch that exits earlier than the real branch.
- **WebSocket has no auth and no rooms.** Every connected client receives every event broadcast by [backend/src/ws.js](backend/src/ws.js). Flag any new `broadcast(...)` call that carries data which wouldn't be safe to show every connected user.
- **PGlite is real Postgres for safety purposes.** Same SQL dialect, same injection rules. Don't be lulled by "it's just an embedded DB." Parameterized queries always.
- **Phaser scene lifecycle.** A new scene, system, or long-lived listener must clean up on shutdown: `scene.events.off(...)`, bus listeners removed, timers/tweens stopped, generated textures released. Leaks compound across hot-reloads and engine remounts.
- **Frontend/backend secret boundary.** `ANTHROPIC_API_KEY` lives in `backend/.env` and is read once at startup. Flag any code path that reads it on the frontend, logs it, includes it in an error response, or passes it through a WebSocket event.
- **`./dev.sh` and `./run.sh` are the entry points.** A change that only works when run with a manual `npm` command those scripts don't invoke needs either a script update or an explicit note in the PR description.
