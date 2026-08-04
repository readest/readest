---
name: settings-panel-screenshot-via-playwright
description: "Recipe for eyeballing a settings-panel change: throwaway spec in e2e/tests driving the real web build, with the two gotchas that bite"
metadata:
  node_type: memory
  type: project
---

To actually *look* at a reader-settings change instead of trusting the diff, drop a throwaway spec into `e2e/tests/` (Playwright's `testDir`) and delete it afterwards. The `openBook` fixture in `e2e/fixtures/base.ts` handles import-and-open, so the whole thing is a few lines:

```ts
const reader = await openBook();
await reader.revealHeader();
await reader.headerBar.locator('button[aria-label="Font & Layout"]').click();
await page.locator('[data-tab="Layout"]').click();
```

Two gotchas cost several iterations on #5287:

- **`.modal-box` resolves to 5 elements** (settings, About, Keyboard Shortcuts, Software Update, Proofread Rules are all mounted), so a bare locator is a strict-mode violation. Use `.first()`.
- **Screenshotting the `[data-setting-id=...]` section directly gives you a clipped image** — the element is taller than its scroll container. Set a tall viewport (`page.setViewportSize({ width: 1280, height: 1200 })`), `el.scrollIntoView({ block: 'end' })`, and screenshot the modal box instead of the section.

Toggle the dependent rows on first (`page.getByText(label, { exact: true }).click()`), otherwise everything below the parent switch renders disabled and you can't judge the real thing.

Warm `pnpm dev-web` before running, per [[web-e2e-local-devserver-cold-compile-flake]]. Clean up `tmp-*.png`, `test-results/`, and `playwright-report/` before committing.
