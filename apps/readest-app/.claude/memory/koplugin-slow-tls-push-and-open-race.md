---
name: koplugin-slow-tls-push-and-open-race
description: "UNFIXED koplugin progress-sync problems seen on a real Kindle during PR #6684 e2e (2026-10-09): writes fail on slow TLS, open-time push races the open-time pull"
metadata:
  node_type: memory
  type: project
  originSessionId: cc8251fc-1efb-47f2-b565-e06504a5e9e4
  modified: 2026-10-09T13:38:07.896Z
---

Found while device-verifying PR #6684 (merged 2026-10-09). Both predate the PR and are UNFIXED.

1. **Pushes fail on slow TLS.** Kindle PW3 TLS handshakes to web.readest.com took 1–13.5s; SYNC_TIMEOUTS `{5,10}` gives the handshake 5s. Reads retry once with RETRY_TIMEOUTS, writes (pushChanges) never do, so ~half of pushes failed with `wantread` while pulls succeeded. Close-time is worst: 4 concurrent forked pushes (config, notes, stats, book) and no later retry.
2. **Open-time push overwrites a newer remote position.** `onPageUpdate` fires on the first render and schedules a push 5s after open; on a slow link the open-time pull is still in flight, so the local (older) position reaches the server first and the pull reads it back. Observed live.

**Why:** both make "read on iOS → Kindle picks it up on open" unreliable on slow Wi-Fi.
**How to apply:** if a user reports progress not syncing from KOReader, check for `wantread` in crash.log before suspecting logic; a fix would retry idempotent config pushes and skip/delay the open-time push until the open pull completes. See [[koreader-kindle-e2e-gotchas]].
