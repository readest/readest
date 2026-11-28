#!/bin/sh
# run_all.sh OUT READEST LITE [SCENARIO...]: play each screen scenario (default: all but the sync
# ones, which behavior.py runs) on Readest (CEF) and Lite, compare them, and print one line per
# scenario. SKIP_CEF=1 reuses OUT's Readest runs (a Lite fix doesn't change them). A scenario with
# "after": "S" starts each app on a copy of its home from S's run in OUT, as after a restart.
set -u
out=$1 readest=$2 lite=$3
shift 3
cd "$(dirname "$0")"
mkdir -p "$out"
[ $# -gt 0 ] || set -- $(ls scenarios | sed -n 's/\.json$//p' | grep -v '^sync-')
for sc in "$@"; do
  echo "== $sc"
  after=$(sed -n 's/.*"after": *"\([^"]*\)".*/\1/p' "scenarios/$sc.json")
  [ -n "${SKIP_CEF:-}" ] || PARITY_HOME=${after:+$out/$after-cef/home} node run_cef.mjs "scenarios/$sc.json" "$out/$sc-cef" "$readest" 2>&1 | tail -1
  PARITY_HOME=${after:+$out/$after-lite/home} python3 run_lite.py "scenarios/$sc.json" "$out/$sc-lite" "$lite" 2>&1 | tail -1
  python3 compare.py "$out/$sc-lite" "$out/$sc-cef" "$out/$sc-report" > "$out/$sc-compare.txt" 2>&1
done
echo
for sc in "$@"; do
  printf '%-24s %s\n' "$sc" "$(grep -E 'steps pass|script errors' "$out/$sc-compare.txt" | sed 's/ -> .*//' | paste -sd ';')"
  grep '^  step ' "$out/$sc-compare.txt"
done
