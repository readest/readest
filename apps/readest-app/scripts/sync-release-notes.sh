#!/bin/bash

# Sync release notes from JSON to XML AppData file
# Usage: ./sync_release_notes.sh [json_file] [xml_file]
#
# Description:
#   Extracts release information from a JSON file and updates the <releases>
#   section in an AppData XML file, then calculates the SHA256 checksum.
#
# Arguments:
#   json_file: Path to JSON file (default: releases.json)
#   xml_file:  Path to XML file (default: appdata.xml)

set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

# Check if required commands are available
if ! command -v jq >/dev/null 2>&1; then
    log_error "jq is required but not installed."
    echo "Install it with: apt-get install jq (Debian/Ubuntu) or brew install jq (macOS)"
    exit 1
fi

# Parse arguments
JSON_FILE="${1:-releases.json}"
XML_FILE="${2:-appdata.xml}"

# Validate input files
if [ ! -f "$JSON_FILE" ]; then
    log_error "JSON file '$JSON_FILE' not found"
    exit 1
fi

if [ ! -f "$XML_FILE" ]; then
    log_error "XML file '$XML_FILE' not found"
    exit 1
fi

# Validate JSON format
if ! jq empty "$JSON_FILE" 2>/dev/null; then
    log_error "Invalid JSON format in '$JSON_FILE'"
    exit 1
fi

# Check if releases key exists
if ! jq -e '.releases' "$JSON_FILE" >/dev/null 2>&1; then
    log_error "No 'releases' key found in JSON file"
    exit 1
fi

echo "================================================"
echo "Release Notes Sync Tool"
echo "================================================"
echo "Source: $JSON_FILE"
echo "Target: $XML_FILE"
echo ""

# Create backup
BACKUP_FILE="${XML_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$XML_FILE" "$BACKUP_FILE"
log_info "Created backup: $BACKUP_FILE"

# Create temporary files
TEMP_XML=$(mktemp)
TEMP_RELEASES=$(mktemp)

# Cleanup function
cleanup() {
    rm -f "$TEMP_XML" "$TEMP_RELEASES"
}
trap cleanup EXIT

# Extract releases from JSON and convert to XML format
log_info "Extracting releases from JSON..."
RELEASE_COUNT=$(jq '.releases | length' "$JSON_FILE")
echo "  Found $RELEASE_COUNT releases"

jq -r '
.releases | to_entries | .[0:10] |  .[] |
"    <release version=\"\(.key)\" date=\"\(.value.date)\">
      <description>
        <ul>
" +
((.value.notes | map("          <li>\(.)</li>")) | join("\n")) +
"
        </ul>
      </description>
    </release>"
' "$JSON_FILE" > "$TEMP_RELEASES"

# Find the releases section in XML and replace it
log_info "Updating XML file..."
awk -v releases="$TEMP_RELEASES" '
BEGIN { in_releases = 0; printed_releases = 0 }
/<releases>/ {
    print $0
    if (printed_releases == 0) {
        while ((getline line < releases) > 0) {
            print line
        }
        close(releases)
        printed_releases = 1
    }
    in_releases = 1
    next
}
/<\/releases>/ {
    in_releases = 0
    print $0
    next
}
in_releases { next }
{ print }
' "$XML_FILE" > "$TEMP_XML"

# Validate the generated XML
if ! grep -q "<releases>" "$TEMP_XML" || ! grep -q "</releases>" "$TEMP_XML"; then
    log_error "Failed to generate valid XML structure"
    log_warn "Restoring from backup..."
    mv "$BACKUP_FILE" "$XML_FILE"
    exit 1
fi

# Remove backup if everything is fine
rm "$BACKUP_FILE"

# Replace original file
mv "$TEMP_XML" "$XML_FILE"
log_info "XML file updated successfully"

# Calculate SHA256 checksum
echo ""
log_info "Calculating SHA256 checksum..."
if command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM=$(sha256sum "$XML_FILE" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
    CHECKSUM=$(shasum -a 256 "$XML_FILE" | awk '{print $1}')
else
    log_error "Neither sha256sum nor shasum found"
    exit 1
fi

# Save checksum to file
CHECKSUM_FILE="${XML_FILE}.sha256"
echo "$CHECKSUM  $XML_FILE" > "$CHECKSUM_FILE"

echo ""
echo "================================================"
echo "Summary"
echo "================================================"
echo "  Updated file:  $XML_FILE"
echo "  Backup file:   $BACKUP_FILE"
echo "  Checksum file: $CHECKSUM_FILE"
echo "  SHA256:        $CHECKSUM"
echo "  Releases:      $RELEASE_COUNT"
echo ""
log_info "Sync completed successfully!"
echo ""
echo "To verify the checksum, run:"
if command -v sha256sum >/dev/null 2>&1; then
    echo "  sha256sum -c $CHECKSUM_FILE"
else
    echo "  shasum -a 256 -c $CHECKSUM_FILE"
fi
