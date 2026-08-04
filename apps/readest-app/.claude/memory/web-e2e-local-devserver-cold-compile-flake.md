---
name: web-e2e-local-devserver-cold-compile-flake
description: "Local web e2e failures \"no visible book section found in the viewer\" are next dev cold-compile contention, not a real regression"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fe0d4e7-c41d-496e-a9ca-e3976830677e
  modified: 2026-08-03T13:42:17.471Z
---

Adding a 6th test to `e2e/tests/annotation.spec.ts` made 2-4 PRE-EXISTING tests fail locally with `no visible book section found in the viewer` (ReaderPage.visibleSectionFrame gives up after 30 x 400ms = 12s).

Not a regression. `playwright.config.ts` runs 4 workers against `pnpm dev-web` locally, so a 6th parallel cold page load starves Next's on-demand compile past that 12s budget. Proof from #5464: the same tests pass 5/5 with the new test excluded, 6/6 with `--workers=1`, and 6/6 (plus the whole 16-test suite) when a `pnpm dev-web` server is already warm on :3000 (`reuseExistingServer: !CI` picks it up).

So before blaming a change for e2e flake: start dev-web yourself, poll `http://localhost:3000/library` until it answers, then run playwright. CI is unaffected - it runs `pnpm start-web` (production build) with 2 retries.

The flip side, from working out of a worktree (#5232): that same `reuseExistingServer` reuses a :3000 server belonging to **another checkout**, and the spec then silently exercises code without your change - it fails (or worse, passes) for reasons that have nothing to do with the diff. `PLAYWRIGHT_BASE_URL` is not read; `playwright.config.ts` hardcodes `PORT = 3000`. Check `lsof -p $(lsof -ti :3000) | grep cwd` before trusting a run from a worktree. Fix: `pnpm exec dotenv -e .env.web -- next dev -p <other-port>` in the worktree plus a throwaway `playwright.tmp.config.ts` (testDir `./e2e/tests`, `baseURL` on that port, no `webServer` block), then `npx playwright test --config=playwright.tmp.config.ts`. Note `dotenv` on PATH is the **Ruby gem** and rejects `-e`; `pnpm exec` picks the dotenv-cli the package scripts use.
