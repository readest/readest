---
name: verify-reader-chrome-needs-e2e
description: pnpm test + pnpm lint miss two whole classes of breakage; changing reader header/footer buttons breaks e2e page objects that hard-code aria-labels
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f8af7206-a4f1-42d4-81f5-51d3c99767b7
  modified: 2026-08-14T16:19:40.216Z
---

`.agents/rules/verification.md` lists `pnpm test` + `pnpm lint` for web-only changes.
On PR #5708 both were green while CI failed **twice**, on two different gates.

**Why:** `pnpm lint` is `tsgo --noEmit && biome lint` and never runs `next build`, and
the unit suite never drives a browser. The `build_web_app` job runs, in order:
`format:check` -> `lint` -> `build-web && check:all` -> **`test:e2e:web`**.

**How to apply — two conditional gates beyond the rules file:**

1. Added a file under `src/app/`? Run `pnpm build-web`. Route-manifest typegen only
   exists there — see [[nextjs-app-dir-reserved-route-filenames]].
2. Changed reader header/footer chrome? Run `pnpm test:e2e:web`.
   `e2e/pages/ReaderPage.ts` hard-codes toolbar buttons by aria-label, e.g. it used
   `button[aria-label="Font & Layout"]` in three helpers (`increaseFontSize`,
   `enableAnnotationTool`, `setPageHeaderVisible`). Deleting that button timed out three
   tests. Those helpers now share `openSettings()`, which goes through the view menu —
   but any future toolbar removal breaks the page object the same way. **Grep `e2e/` for
   the aria-label before deleting a reader button.**

**Reading local e2e results:** local runs are genuinely flaky under parallel workers on a
cold dev server (see [[web-e2e-local-devserver-cold-compile-flake]]). In one session the
same tree produced 5 failures, then a different 2, then 0 with `--workers=1`. Don't
conclude from a local failure set. CI failed *exactly* the 3 tests that touched the
changed code, which is the signal; re-run suspects with `--workers=1` before believing them.
