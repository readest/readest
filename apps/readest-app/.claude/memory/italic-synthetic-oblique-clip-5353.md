---
name: italic-synthetic-oblique-clip-5353
description: "#5353 italic last glyph clipped at run end on Android = WebView >=~148 synthetic-oblique regression, not Readest code; WebView 124 + desktop Chrome 150 clean"
metadata: 
  node_type: memory
  type: project
  originSessionId: 51975c5a-5ec4-4564-bb53-0b79368768b6
  modified: 2026-07-28T14:06:36.554Z
---

Issue #5353 (2026-07-26): on Android, the last glyph of an italic run is sliced by a clean
vertical cut exactly where the following non-italic run (usually a space) begins —
"obliterated" reads as "obliteratea".

**Root cause (engine, not Readest):** only fonts with NO true italic face are affected
(reporter's custom EzTechieLife.ttf, and Roboto Slab which has no italic anywhere — Google
Fonts silently drops the requested `ital` axis and serves normal-only faces). Italic in
those fonts = Chromium **synthetic oblique** (skewed glyphs). The skewed overhang past the
run's advance width gets clipped at the text-run boundary on the reporter's Android
WebView 150.0.7871.181. Evidence it's an engine regression:

- Same minimal page, navigated inside the actual Readest app WebView (emulator, Android 15,
  WebView **124**) via CDP: **no clip**.
- Xiaomi test phone (Android 16): Chrome **149** minimal page — no clip; Readest + WebView
  **148.0.7778.217**, REAL EPUB (Durant "Age of Reason", section idx 14 has 26 `<em>`s) with
  `* { font-family:'Roboto Slab' !important }` injected into the section iframe — no clip
  ("*World* he", "*Annales* (1615)" fully intact). Brackets the regression to **M149–M150**,
  or a Finch/feature-gated rollout (Graphite?) where version alone doesn't decide.
- Desktop macOS Chrome **150.0.7871.184 — same 7871 branch as the reporter**: no clip →
  Android-specific path.
- Window 124→150 contains the Fontations/Skrifa rollout (webfonts M133, system fonts M136)
  and the Android WebView synthetic bold/italic rework crbug 446078849 / 455556228
  ([Merge M142]). No existing crbug describes this clipping — worth filing upstream with
  the minimal repro (italic span of a no-italic-face font followed by upright text).

Readest-side notes: custom fonts get ONE @font-face (style normal) in
`src/styles/fonts.ts createFontCSS` → custom-font italics are always synthesized; nothing
in `style.ts` clips at run boundaries (`overflow: clip` injection only fires on
`white-space: nowrap` rules). No clean CSS mitigation: `font-synthesis-style: none` would
render italics upright; inline transforms don't apply to inline boxes. Realistic options:
file upstream crbug + note in issue; possibly drop/replace Roboto Slab italics.

Release Android build blocks cleartext http (ERR_CLEARTEXT_NOT_PERMITTED) — minimal pages
can't be loaded into its WebView; test in a real book instead: CDP eval into the reader,
`view.renderer.getContents()[0].doc`, inject style, `view.renderer.goTo({index, anchor: () => em})`.

Minimal repro (serve + open in any WebView):
`<p style="font-family:'Roboto Slab'">And it <i>obliterated</i> everything. <i>d</i> d</p>`
with `<link href="https://fonts.googleapis.com/css2?family=Roboto+Slab:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">`
on black bg. CDP lane: `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`,
raw WS Page.navigate + Page.captureScreenshot (Playwright connectOverCDP fails on WebView —
its /json/version browser WS URL points at an unreachable port).

Related: [[epub-undeclared-cover-entry-5273]] (also font/asset fallback), WebView-148-era
regressions [[issue-4584-tap-death-investigation]], [[android-system-selection-menu-one-off]].
