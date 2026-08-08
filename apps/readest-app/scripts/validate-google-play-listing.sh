#!/bin/bash

# Dry-run the Google Play store listing (text, images, screenshots) without
# building or uploading a binary and without committing anything. Run this
# before `pnpm release-google-play` so a bad listing fails in seconds rather
# than after a full Android build.
#
#   pnpm validate-google-play

set -e

VERSION=$(jq -r '.version' package.json)

if [[ -z "$GOOGLE_PLAY_JSON_KEY_FILE" ]]; then
  echo "❌ GOOGLE_PLAY_JSON_KEY_FILE is not set" >&2
  exit 1
fi

# Regenerate the changelog so the dry run reflects what a release would ship.
# supply itself cannot validate changelogs without a version code (they attach
# to an uploaded binary), so this is a local length check only.
CHANGELOG_DIR="../../fastlane/metadata-play/android/en-US/changelogs"
mkdir -p "$CHANGELOG_DIR"
NOTES=$(jq -r --arg ver "$VERSION" '.releases[$ver].notes // empty | map("• " + .) | join("\n")' release-notes.json)
if [[ -n "$NOTES" ]]; then
  if [[ ${#NOTES} -gt 480 ]]; then
    NOTES="${NOTES:0:477}..."
  fi
  echo "$NOTES" > "$CHANGELOG_DIR/default.txt"
  echo "📝 Release notes for v$VERSION written (${#NOTES}/500 chars)"
else
  echo "⚠️  No release notes found for v$VERSION in release-notes.json"
fi

# Local limit checks - cheaper to catch here than in a Play API round trip.
PLAY_META="../../fastlane/metadata-play/android/en-US"
check_len() {
  local file="$1" limit="$2" n
  n=$(wc -m < "$file" | tr -d ' ')
  if [[ "$n" -gt "$limit" ]]; then
    echo "❌ $(basename "$file") is $n chars, limit is $limit" >&2
    exit 1
  fi
  printf "   %-24s %5s/%s\n" "$(basename "$file")" "$n" "$limit"
}
echo "📏 Listing text limits:"
check_len "$PLAY_META/title.txt" 30
check_len "$PLAY_META/short_description.txt" 80
check_len "$PLAY_META/full_description.txt" 4000

cd ../../

echo "🔍 Validating listing against Google Play (nothing is committed)..."
# --validate_only validates the edit instead of committing it.
# Changelogs are skipped because they attach to a version code and this run
# uploads no binary; the real upload_production lane keeps them enabled.
fastlane supply \
  --metadata_path fastlane/metadata-play/android \
  --track production \
  --skip_upload_apk --skip_upload_aab --skip_upload_changelogs \
  --validate_only

echo "✅ Listing validated. Nothing was published."
