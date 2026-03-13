#!/usr/bin/env bash
#
# Starts a Next.js dev server, launches the Tauri app with webdriver
# (no file watcher, no built-in dev server), waits for the WebDriver
# server on port 4445, runs tests, then tears down everything cleanly.
#
set -euo pipefail

DEV_PORT=3000
WEBDRIVER_PORT=4445
POLL_INTERVAL=3
TIMEOUT=300

cleanup() {
  if [[ -n "${TAURI_PID:-}" ]]; then
    pkill -P "$TAURI_PID" 2>/dev/null || true
    kill "$TAURI_PID" 2>/dev/null || true
    wait "$TAURI_PID" 2>/dev/null || true
  fi
  if [[ -n "${DEV_PID:-}" ]]; then
    pkill -P "$DEV_PID" 2>/dev/null || true
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  lsof -ti :"$WEBDRIVER_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :"$DEV_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting Next.js dev server..."
dotenv -e .env.tauri -- next dev &
DEV_PID=$!

echo "Waiting for dev server on port $DEV_PORT..."
elapsed=0
while ! curl -sf "http://localhost:${DEV_PORT}" >/dev/null 2>&1; do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "ERROR: Dev server exited unexpectedly."
    exit 1
  fi
  if (( elapsed >= TIMEOUT )); then
    echo "ERROR: Timed out waiting for dev server on port $DEV_PORT."
    exit 1
  fi
  sleep "$POLL_INTERVAL"
  (( elapsed += POLL_INTERVAL ))
done

echo "Starting Tauri app with webdriver (no-watch, skip beforeDevCommand)..."
dotenv -e .env.tauri -- tauri dev --features webdriver --no-watch \
  --config '{"build":{"beforeDevCommand":""}}' &
TAURI_PID=$!

echo "Waiting for WebDriver server on port $WEBDRIVER_PORT (timeout ${TIMEOUT}s)..."
elapsed=0
while ! curl -sf "http://127.0.0.1:${WEBDRIVER_PORT}/status" >/dev/null 2>&1; do
  if ! kill -0 "$TAURI_PID" 2>/dev/null; then
    echo "ERROR: Tauri app exited before WebDriver became ready."
    exit 1
  fi
  if (( elapsed >= TIMEOUT )); then
    echo "ERROR: Timed out waiting for WebDriver on port $WEBDRIVER_PORT."
    exit 1
  fi
  sleep "$POLL_INTERVAL"
  (( elapsed += POLL_INTERVAL ))
done

echo "WebDriver is ready. Running Tauri tests..."
pnpm vitest --config vitest.tauri.config.mts --watch=false
