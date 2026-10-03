---
name: header-footer-style-5938
description: "#5938 customizable header/footer font size, text color, background; MERGED #5960; auto/none/custom chip resolver shared by SectionInfo + ProgressBar"
metadata:
  type: project
---

#5938 asked for a transparent option on the scrolled-mode page-number chip
("jarring white background after I set the background myself"). Maintainer
scoped it up to the full title: font size + text color + background color, and
explicitly asked that **the header get a matching chip**, not just the footer.
MERGED #5960 (squash `0f913bfa6`, 2026-08-30).

**Root cause of the report.** The footer chip is `bg-base-100/85`, which reads
as "the page color" only while the page uses the theme background. A reader
background image paints as `.foliate-viewer::before` (`mix-blend-mode:
multiply`, `opacity: .6`), but `ProgressBar` renders as a **sibling** of
`.foliate-viewer` (`BooksGrid.tsx`), above that overlay — so the chip never
picks up the tint and stays a bright white blob. Same class of bug will hit any
new chrome placed as a sibling of the viewer.

**Why only the footer ever had a pill.** `FoliateViewer` does
`setScrollMargins({ top: bookData?.isFixedLayout ? 0 : scrollTop, … })`, so in
scrolled mode the header band **is** reserved for reflowable books but **not**
for fixed-layout — while `footerReservesBand()` returns false in scrolled mode
for everything. The asymmetry was mechanical, not a design decision.

**Shape (4 fields on `ViewConfig`, mode overloaded into the string like
`borderColor`):** `headerFooterFontSize` (12, and **14 in
`DEFAULT_EINK_VIEW_SETTINGS`** so e-ink keeps its old `text-sm`),
`headerFooterTextColor` (`''` = theme), `headerFooterBackground`
(`'auto' | 'none' | #rrggbb`), `headerFooterBgOpacity`. Resolvers live in
`src/app/reader/utils/headerFooterStyle.ts` so `SectionInfo` and `ProgressBar`
cannot drift; they tolerate `undefined` because tests build partial
`ViewSettings` and old configs predate the fields.

`auto` reproduces prior behaviour exactly (footer pill in scrolled mode, header
bare); a custom color paints **both** header and footer in **both** flow modes,
otherwise picking a color would be a silent no-op for paginated readers.

**Two traps that bite anyone editing this code:**

- The scrolled-mode pill is *also* the tap target for tap-to-toggle
  ([[tap-toggle-progress-bar-5293]]). Keep `pointer-events-auto cursor-pointer`
  even when the backdrop is off, or `Background: none` silently removes the
  gesture with the chip.
- The fixed-layout `mix-blend-difference` fallback must stand down once the
  reader styles the chrome — it inverts a chosen text color, and differencing a
  child carrying its own background paints it solid black
  ([[footer-pill-vs-blend-5342]]). Load-bearing here: the reporter is on a PDF,
  where `none` would otherwise flip the blend back on.

E-ink honours font size but ignores both colors (arbitrary hue renders as
indistinguishable gray; the theme chip already carries `eink-bordered`).

**Zero new i18n keys** — `Font Size`, `Text Color`, `Background Color`,
`Opacity`, `Auto`, `None`, `Custom` all already existed in the locale files.
Check `public/locales/zh-CN/translation.json` for existing keys before minting
new labels; `en/translation.json` is empty by design (key-as-content).

Verified in dev-web via Chrome MCP only. **Never checked on Android or an
e-ink device**, and the reporter is on Android.
