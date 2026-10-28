#!/usr/bin/env bash
# Jalankan backend (FastAPI :8000) dan frontend (Vite :5173) sekaligus.
# Pakai: ./dev.sh   lalu buka http://localhost:5173   (Ctrl+C untuk berhenti)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Backend: buat venv dan pasang dependensi kalau belum ada
if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "[setup] membuat venv backend..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi

# Frontend: pasang node_modules kalau belum ada
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[setup] npm install frontend..."
  (cd "$ROOT/frontend" && npm install)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --reload --port 8000 --host 127.0.0.1) &
(cd "$ROOT/frontend" && npm run dev -- --host 127.0.0.1) &

echo
echo "  Waspada Nusantara berjalan:  http://localhost:5173"
echo "  API backend:                 http://localhost:8000/api/health"
echo
wait
