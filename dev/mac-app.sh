#!/usr/bin/env bash
#
# Собирает macOS-приложение из текущего состояния репозитория и ставит его
# в /Applications, заменяя предыдущую сборку.
#
#   ./dev/mac-app.sh          — собрать и установить
#   ./dev/mac-app.sh --open   — ещё и запустить после установки
#
# Для повседневной работы это НЕ нужно: `pnpm tauri dev` из apps/readest-app
# показывает правки во фронтенде мгновенно. Этот скрипт нужен, когда хочешь
# пользоваться ридером как обычным приложением — из Launchpad, с иконкой в
# доке, без открытого терминала.
#
# Первая сборка компилирует форк Tauri целиком (~десятки минут). Дальше cargo
# переиспользует target/ и укладывается в единицы минут.

set -euo pipefail

# brew кладёт шимы rustup мимо PATH неинтерактивных шеллов.
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Readest.app"
BUILT_APP="$REPO_ROOT/target/release/bundle/macos/$APP_NAME"
INSTALLED_APP="/Applications/$APP_NAME"

open_after=false
[[ "${1:-}" == "--open" ]] && open_after=true

command -v cargo >/dev/null || { echo "cargo не найден — проверь PATH до /opt/homebrew/opt/rustup/bin"; exit 1; }
command -v pnpm  >/dev/null || { echo "pnpm не найден — brew install pnpm"; exit 1; }

started=$(date +%s)
echo "==> Сборка из $(git -C "$REPO_ROOT" rev-parse --short HEAD) (ветка $(git -C "$REPO_ROOT" branch --show-current))"

# --features devtools оставляет включённым веб-инспектор: правый клик →
# Inspect Element прямо в собранном приложении. Для отладки своих правок это
# сильно полезнее, чем чистая релизная сборка.
cd "$REPO_ROOT/apps/readest-app"
pnpm tauri build --features devtools --bundles app

[[ -d "$BUILT_APP" ]] || { echo "Сборка прошла, но $BUILT_APP не найден"; exit 1; }

echo "==> Установка в /Applications"
# Приложение может быть запущено — иначе замена молча оставит старую версию.
if pgrep -x "Readest" >/dev/null; then
  echo "    закрываю запущенный Readest"
  osascript -e 'quit app "Readest"' 2>/dev/null || pkill -x Readest || true
  # ждём, пока процесс действительно уйдёт
  for _ in $(seq 20); do pgrep -x "Readest" >/dev/null || break; sleep 0.25; done
fi

rm -rf "$INSTALLED_APP"
cp -R "$BUILT_APP" "$INSTALLED_APP"

# Сборка не подписана Developer ID: снимаем карантин, иначе Gatekeeper
# откажется открывать приложение с «повреждён или не может быть проверен».
xattr -dr com.apple.quarantine "$INSTALLED_APP" 2>/dev/null || true
codesign --force --deep --sign - "$INSTALLED_APP" 2>/dev/null || true

elapsed=$(( $(date +%s) - started ))
echo "==> Готово за $((elapsed / 60))м $((elapsed % 60))с: $INSTALLED_APP"

if $open_after; then
  open "$INSTALLED_APP"
fi
