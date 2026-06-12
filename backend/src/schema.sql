-- Agent Pipeline Builder schema.
-- Runs on PGlite (PostgreSQL 16 compiled to WASM) — gen_random_uuid(), UUID,
-- TIMESTAMPTZ and NUMERIC are all native, so this is portable to a real
-- PostgreSQL server unchanged.

CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model         TEXT,              -- optional per-station model override
  style         TEXT,              -- building style for the UI (cottage, shop, …)
  position_x    FLOAT NOT NULL,
  position_y    FLOAT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Upgrade older databases that predate the style column (idempotent on boot).
ALTER TABLE stations ADD COLUMN IF NOT EXISTS style TEXT;

-- Post office support. A station with type='post_office' is a town's mail hub:
-- it forwards its gathered upstream output ("mail") to another town's post office
-- (send_to_post_office_id), which fans the mail out to its local distribution
-- targets (see mail_distributions). 'agent' stations are ordinary LLM houses.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE stations ADD COLUMN IF NOT EXISTS send_to_post_office_id UUID REFERENCES stations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  from_station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  to_station_id   UUID REFERENCES stations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  input       TEXT,                            -- kickoff input handed to root stations
  error       TEXT,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total_tokens   INTEGER,                       -- run-level rollup of step tokens
  total_cost_usd NUMERIC(10, 6),                -- run-level rollup of step cost
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID REFERENCES runs(id) ON DELETE CASCADE,
  station_id   UUID REFERENCES stations(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  tokens_used   INTEGER,                         -- input + output, kept for back-compat
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10, 6),
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

-- Upgrade older databases that predate the token/cost columns (idempotent on boot).
ALTER TABLE run_steps ADD COLUMN IF NOT EXISTS input_tokens  INTEGER;
ALTER TABLE run_steps ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE runs      ADD COLUMN IF NOT EXISTS total_tokens   INTEGER;
ALTER TABLE runs      ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(10, 6);

-- Cosmetic map decorations (trees, roads, fountains, …). Purely visual — never
-- part of the agent data model.
CREATE TABLE IF NOT EXISTS decorations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  position_x  FLOAT NOT NULL,
  position_y  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- A receiving post office's fan-out targets: the local buildings (stations) it
-- distributes arriving mail to. Kept separate from `connections` so it never
-- participates in a town's normal run DAG — these edges only seed cross-town
-- deliveries. Both FKs CASCADE so deleting a station prunes its routes.
CREATE TABLE IF NOT EXISTS mail_distributions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_office_station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  target_station_id      UUID REFERENCES stations(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_step_id  UUID REFERENCES run_steps(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,  -- text | image | video | file
  content      TEXT,           -- for text artifacts
  file_path    TEXT,           -- for binary artifacts
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- User-registered models beyond the built-in Anthropic set. Stations reference
-- a row here by storing its UUID in stations.model; resolveModel() in the
-- providers layer dispatches by `provider` and uses the price columns to bill.
-- Secrets (API keys) are NOT stored here — they live in env vars per provider.
CREATE TABLE IF NOT EXISTS custom_models (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label               TEXT NOT NULL,
  provider            TEXT NOT NULL,                -- 'anthropic'|'openai'|'google'|'openai-compatible'
  model_id            TEXT NOT NULL,                -- actual model string sent to the provider
  base_url            TEXT,                         -- only set for openai-compatible
  input_price_per_m   NUMERIC NOT NULL DEFAULT 0,
  output_price_per_m  NUMERIC NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stations_pipeline   ON stations(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_connections_pipeline ON connections(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_runs_pipeline        ON runs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_run        ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_step       ON artifacts(run_step_id);
CREATE INDEX IF NOT EXISTS idx_decorations_pipeline ON decorations(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_mail_dist_po          ON mail_distributions(post_office_station_id);
