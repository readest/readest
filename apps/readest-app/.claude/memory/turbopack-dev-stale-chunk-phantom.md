---
name: turbopack-dev-stale-chunk-phantom
description: "Turbopack dev can serve a STALE component chunk even after full page reload — verify live-smoke code identity via React fiber String(f.type) before debugging \"bugs\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 138d91ff-f7d6-465b-8a89-35b703957a3c
  modified: 2026-08-03T17:29:59.725Z
---

During the annotations-hub live smoke (2026-08-03), a long-running `pnpm dev-web` served a BooknoteView chunk that predated 3 committed revisions — even after `location.reload()`. Symptom looked like a real regression (toolbar missing, list blank); hours of debugging risk.

**Why:** many rapid worktree commits + HMR cycles left Turbopack's in-memory/disk module graph inconsistent; reload re-served the stale compiled chunk.

Same failure hit the Playwright web lane (2026-08-04, #4977): after a `git stash push` / `git stash pop` cycle to prove a test red then green, the dev server went back to serving the pre-fix chunk and the new test failed again — the giveaway was a class name (`h-11`) in the assertion output that no longer existed in the source. Playwright asserting on rendered class names is a free identity check; if the DOM shows classes you deleted, it's this, not your fix.

**How to apply:** before treating a live-smoke anomaly as a code bug, verify the browser executes the current source: grab the component's fiber from a DOM node (`Object.keys(el).find(k=>k.startsWith('__reactFiber$'))`, walk `.return`, `String(f.type)`) and grep it for a symbol only the newest revision contains. If stale: kill dev server, `rm -rf .next`, restart. Also note the claude-in-chrome extension BLOCKS returning large innerHTML/source strings ("Cookie/query string data") — return booleans (`src.includes('x')`) instead.

**Recurred 2026-08-04 (#5270 metadata e2e), and RESTART ALONE IS NOT THE CURE:** a `pnpm dev-web` started *after* all edits in a fresh worktree still served page.tsx without the new wiring (an adjacent old `console.log` fired, the new lines didn't — cheap identity check: add a throwaway `console.log` next to the new code and watch for it in the spec's `page.on('console')`). After `rm -rf .next` + restart it worked; then a plain server restart *reusing the existing .next* served stale chunks AGAIN. When verifying code changes through `next dev`, `rm -rf .next` before EVERY server start, not just once.
