---
name: rsvp-playwright-dev-web-recipe
description: "How to drive Speed Reading (RSVP) on dev-web with Playwright — Shift+V doesn't open it headless; use View Options menu; read chunks via .rsvp-chunk-word"
metadata:
  node_type: memory
  type: reference
  originSessionId: fa63c042-012d-489a-851d-7e9140ece0dc
  modified: 2026-11-12T10:01:25.776Z
---

Recipe used for #7416 (2026-11-12) to check RSVP in a real browser:

- `pnpm dev-web -p 3007` in the worktree (port 3000 is the e2e default; a temp `e2e/tmp-*.config.ts` with `testDir: './tests'`, `testMatch` on a temp spec and `baseURL` 3007 avoids its webServer). Delete the temp config/spec, `test-results/`, `playwright-report/` afterwards.
- `openBook()` fixture imports the Alice EPUB and leaves the sidebar open: click `getByRole('treeitem', { name: /Chapter 1 - Down the Rabbit Hole/ })`; `reader.nextPage()` stayed on the title page.
- **Shift+V does not open RSVP headless.** Use `reader.revealHeader()` → `[aria-label="View Options"]` → `getByText('Speed Reading Mode')`, then `getByText('From Current Page')` in the start dialog. Overlay: `getByTestId('rsvp-overlay')`; wait ~4 s for the countdown, Space pauses.
- Settings row: `[aria-label="Settings"]`. Read state from the DOM after a ~200 ms wait — reading right after a keypress returns the previous render.
- `data-eink` set via `document.documentElement.setAttribute` only toggles the e-ink CSS rules, not the e-ink theme colors; say so when reporting.

Related: [[settings-panel-screenshot-via-playwright]], [[verify-reader-chrome-needs-e2e]].
