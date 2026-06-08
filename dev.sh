#!/usr/bin/env bash
# Agent Valley — single-command DEV launcher.
# Starts the backend (auto-reloads on file changes via `node --watch`) and the
# Vite UI together. One button: ./dev.sh  (or  MOCK_LLM=1 ./dev.sh  to skip the key)
cd "$(dirname "$0")"
set -e

echo "==> Installing backend deps"
( cd backend && npm install )
echo "==> Installing frontend deps"
( cd frontend && npm install )

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "==> Created backend/.env — set ANTHROPIC_API_KEY (or start with MOCK_LLM=1 ./dev.sh)"
fi

if [ ! -d backend/data ]; then
  echo "==> First run — seeding an example neighborhood"
  ( cd backend && node src/seed.mjs ) || true
fi

set +e
pids=()
cleanup() {
  echo
  echo "==> Stopping Agent Valley…"
  kill "${pids[@]}" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

# Backend first (UI proxies /api + /ws to it), then the Vite dev server.
( cd backend && npm run dev ) &
pids+=($!)
( cd frontend && npm run dev ) &
pids+=($!)

echo
echo "================================================================"
echo "  🌻 Agent Valley (dev) — backend & UI auto-reload on change"
echo "  ▶ Open:    http://localhost:5173"
echo "    backend: http://localhost:4000"
echo "    No API key? start with:  MOCK_LLM=1 ./dev.sh"
echo "    Press Ctrl-C to stop everything."
echo "================================================================"

# Keep running until a child exits or Ctrl-C; cleanup() stops the other one.
wait
