#!/usr/bin/env bash
# Start backend and frontend in parallel
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo " Spread Alpha Dashboard"
echo "============================================"
echo ""
echo "Backend  →  http://localhost:8000"
echo "Frontend →  http://localhost:5173"
echo ""
echo "Press Ctrl-C to stop both servers."
echo ""

trap 'kill 0' INT

# Backend
(cd "$ROOT" && uvicorn api.main:app --reload --port 8000) &

# Frontend
(cd "$ROOT/frontend" && npm run dev) &

wait
