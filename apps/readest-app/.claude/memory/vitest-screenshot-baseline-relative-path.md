---
name: vitest-screenshot-baseline-relative-path
description: "Browser screenshot baselines could not be regenerated ('Couldn't write file to fs', --update silently a no-op) because vitest.browser.config.mts resolveScreenshotPath returned a relative path; writes go through Vite server.fs which denies relative paths - fix = resolve(root, ...)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c6e61903-3da9-4c41-9d2d-3e2df4baa0a2
  modified: 2026-08-02T18:35:51.086Z
---

2026-08-03, hit while fixing PR #5351 (MERGED into that PR). `pnpm test:browser <file> --update` did not refresh `toMatchScreenshot` baselines, and deleting the PNGs did not regenerate them either — every attempt failed with `Error: Couldn't write file to fs`. This blocked the contributor for days and my own first advice ("delete the PNGs and re-run") was wrong.

**Mechanism:** `apps/readest-app/vitest.browser.config.mts` set a custom `resolveScreenshotPath` (to strip the platform suffix so one baseline serves macOS + Linux) that returned a **relative** path. Reading worked because `readFile` resolves relative paths against `process.cwd()`. Writing does not: `@vitest/browser` `writeScreenshot()` calls `assertBrowserApiWrite()` then `assertBrowserFileAccess()` → `isFileLoadingAllowed(vite.config, path)`, which compares against absolute `server.fs.allow` roots, so a relative path is always denied. Both guards' errors get swallowed into the generic `Couldn't write file to fs` (the real cause is only in `error.cause`, which vitest does not print).

**Fix:** make the callback absolute — it receives `root`:
`resolveScreenshotPath: ({ arg, browserName, ext, root, testFileDirectory, testFileName }) => resolve(root, testFileDirectory, '__screenshots__', testFileName, ...)`

**How to apply:** `api.allowWrite` is NOT the problem — it defaults to true for a non-exposed server; I added it first and it changed nothing, so verify before adding config. When a vitest browser matcher fails with a generic wrapped error, read the dist source (`node_modules/.pnpm/@vitest+browser*/dist/index.js`) for the throw site rather than guessing; do NOT edit node_modules to instrument (pnpm hard-links to the global store). Baselines are deliberately platform-agnostic here (`allowedMismatchedPixelRatio: 0.02`), so regenerating on macOS is valid for Linux CI. Related: [[popup-filter-containing-block-5351]]
