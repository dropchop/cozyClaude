#!/usr/bin/env bash
# Agent Pipeline Builder — one-shot launcher.
# Installs deps, builds the frontend, then starts the backend which serves both
# the API/WebSocket and the built UI on a single port.
set -e
cd "$(dirname "$0")"

echo "==> Installing backend deps"
( cd backend && npm install )

echo "==> Installing + building frontend"
( cd frontend && npm install && npm run build )

if [ ! -f backend/.env ]; then
  echo "==> No backend/.env found — creating from example (set ANTHROPIC_API_KEY!)"
  cp backend/.env.example backend/.env
fi

if [ ! -d backend/data ]; then
  echo "==> First run — seeding an example town"
  ( cd backend && node src/seed.mjs ) || true
fi

echo "==> Starting server on http://localhost:${PORT:-4000}"
cd backend && npm start
