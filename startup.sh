#!/usr/bin/env bash
# Start a local server for myStar-app.
# Closing this shell (Ctrl+C or terminal exit) automatically stops the server.

set -e

PORT="${PORT:-8000}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM HUP

cd "$ROOT"

echo "Serving $ROOT"
echo "Open http://localhost:$PORT"
echo "Press Ctrl+C (or close this terminal) to stop."
echo

python3 -m http.server "$PORT" &
SERVER_PID=$!

wait "$SERVER_PID"
