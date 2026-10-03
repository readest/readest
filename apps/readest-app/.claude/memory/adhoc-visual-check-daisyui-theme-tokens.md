---
name: adhoc-visual-check-daisyui-theme-tokens
description: "A throwaway *.browser.test.tsx that imports globals.css renders with daisyUI's DEFAULT tokens (--depth: 1), painting inset hairlines above every .input/.select that the real app never shows - inject themeVariables' token block before screenshotting or you will 'fix' phantom bugs in shared primitives"
metadata: 
  node_type: memory
  type: project
  originSessionId: 36e8617f-0012-4044-b2b6-5059e5ad403c
  modified: 2026-09-07T10:05:06.526Z
---

2026-09-07, while redesigning the Proofread Rules panel (PR #6109). Rendering a
component in a scratch `src/__tests__/**/zz*.browser.test.tsx` that only does
`import '@/styles/globals.css'` is **not** what the app looks like. Readest pins
daisyUI's shape tokens per theme in `src/styles/themes.ts` (`themeVariables`),
and nothing applies them unless a theme is mounted. Without them you get
daisyUI's defaults — notably `--depth: 1`, which turns `.input` / `.select`'s
`box-shadow: 0 1px ... inset` into a visible hairline above every field.

I read that hairline as a real defect in `SettingsInput` / `SettingsSelect`
(DESIGN.md §5 does say the chromeless recipe must kill box-shadow, and the
primitives only suppress it on `:focus`) and was about to patch both shared
primitives — a change that would have touched every settings panel. The app
ships `--depth: 0`, so the resting shadow is transparent and there was nothing
to fix.

**How to apply** — before `toMatchScreenshot`, set the token block on
`document.documentElement`:
`--radius-selector: 1.9rem, --radius-field: 0.5rem, --radius-box: 1rem,`
`--size-selector: 0.25rem, --size-field: 0.25rem, --border: 1px,`
`--depth: 0, --noise: 0` (copy from `themeVariables` in `src/styles/themes.ts`).
Set `data-eink='true'` on the same element for the e-ink pass.

Two more traps in the same harness: the test iframe is only ~415 CSS px wide,
so a `.modal-box` forced wider than that gets **cropped**, not scaled — check
mobile width and screenshot inner sections (`ul`, a single row) for detail;
and `position: static` on the `.modal-box` to un-clip it reflows the whole
dialog. Un-clip with `height/max-height` + `inset-inline-start` overrides
instead. Delete the scratch test **and** its `__screenshots__` dir when done.

Related: [[vitest-screenshot-baseline-relative-path]],
[[settings-panel-screenshot-via-playwright]], [[daisyui-v5-tailwind-v4-migration]].
