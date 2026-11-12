#!/bin/sh
# Builds dist/ (src-tauri's frontendDist): readest-app's Tauri export without source maps, plus
# QuickJS bytecode next to every script (`<file>.js.qjsc`), which tauri-runtime-blitz loads instead
# of compiling the source (QuickJS bytecode depends on the QuickJS version, not the CPU). Its stacks
# read `/_next/static/chunks/<file>.js:line:col`; the source maps that resolve them go to dist-maps/.
# SKIP_APP_BUILD=1 reuses an existing apps/readest-app/out.
set -e
cd "$(dirname "$0")/.."
[ -n "$SKIP_APP_BUILD" ] || pnpm --filter @readest/readest-app build
rm -rf dist dist-maps
mkdir dist
rsync -a --exclude '*.map' ../readest-app/out/ dist/
rsync -a --include '*/' --include '*.map' --exclude '*' --prune-empty-dirs ../readest-app/out/ dist-maps/
cargo run --release -p blitz-qjs-script --bin qjs-precompile -- dist
