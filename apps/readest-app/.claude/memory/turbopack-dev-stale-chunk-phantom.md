---
name: turbopack-dev-stale-chunk-phantom
description: "Turbopack dev can serve a STALE component chunk even after full page reload — verify live-smoke code identity via React fiber String(f.type) before debugging \"bugs\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 138d91ff-f7d6-465b-8a89-35b703957a3c
  modified: 2026-08-02T16:31:29.923Z
---

During the annotations-hub live smoke (2026-08-03), a long-running `pnpm dev-web` served a BooknoteView chunk that predated 3 committed revisions — even after `location.reload()`. Symptom looked like a real regression (toolbar missing, list blank); hours of debugging risk.

**Why:** many rapid worktree commits + HMR cycles left Turbopack's in-memory/disk module graph inconsistent; reload re-served the stale compiled chunk.

**How to apply:** before treating a live-smoke anomaly as a code bug, verify the browser executes the current source: grab the component's fiber from a DOM node (`Object.keys(el).find(k=>k.startsWith('__reactFiber$'))`, walk `.return`, `String(f.type)`) and grep it for a symbol only the newest revision contains. If stale: kill dev server, `rm -rf .next`, restart. Also note the claude-in-chrome extension BLOCKS returning large innerHTML/source strings ("Cookie/query string data") — return booleans (`src.includes('x')`) instead.
