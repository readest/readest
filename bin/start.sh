#!/usr/bin/env bash
set -euo pipefail
cd /home/readest/docker
docker compose -f compose.local.yaml -f compose.build.yaml up --build -d
