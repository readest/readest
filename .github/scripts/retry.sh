#!/usr/bin/env bash
# Run a command, retrying with backoff when it fails. For release calls to
# GitHub that fail on a transient server error: an HTTP 500 on one
# `gh release upload` failed the v0.12.20 Windows arm64 leg after a 45-minute
# build. Only wrap commands that are safe to repeat (uploads with --clobber,
# downloads with --clobber).
# Usage: retry.sh <command> [args...]
set -u

attempts=5
delay=10
for ((i = 1; ; i++)); do
  "$@" && exit 0
  status=$?
  if ((i >= attempts)); then
    echo "::error::Failed after $attempts attempts (exit $status): $*"
    exit "$status"
  fi
  echo "::warning::Attempt $i/$attempts failed (exit $status), retrying in ${delay}s: $*"
  sleep "$delay"
  delay=$((delay * 2))
done
