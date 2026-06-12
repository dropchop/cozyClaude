#!/usr/bin/env bash
# Agent Pipeline Builder — one-shot launcher.
# Installs deps, builds the frontend, then starts the backend which serves both
# the API/WebSocket and the built UI on a single port.
set -e
cd "$(dirname "$0")"

# Install only when deps are missing or the lockfile changed since the last
# install. npm writes node_modules/.package-lock.json after each successful
# install, so if it's newer than package-lock.json nothing changed — skip the
# redundant npm install on every launch (the frontend is still rebuilt below).
maybe_install() {
  local dir=$1
  if [ ! -d "$dir/node_modules" ] || [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]; then
    echo "==> Installing $dir deps"
    ( cd "$dir" && npm install )
  else
    echo "==> $dir deps already up to date"
  fi
}

maybe_install backend

echo "==> Building frontend"
maybe_install frontend
( cd frontend && npm run build )

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
