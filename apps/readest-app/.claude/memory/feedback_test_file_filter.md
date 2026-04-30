---
name: test-file-filter
description: Use pnpm test/test:browser with path directly (no --) to run a single test file
type: feedback
---

Run a specific test file with `pnpm test <path>` or `pnpm test:browser <path>` — no `--` separator.

**Why:** Adding `--` before the path (e.g. `pnpm test:browser -- <path>`) causes vitest to ignore the file filter and run all test files. Without `--`, pnpm appends the path directly to the vitest command, which correctly filters to that file only.

**How to apply:** Always use `pnpm test src/__tests__/foo.test.ts` or `pnpm test:browser src/__tests__/foo.browser.test.tsx` when verifying a specific test file.
