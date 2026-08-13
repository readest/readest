---
name: opds-download-format-filter-5583
description: "#5583 OPDS download format filter and split button: Calibre names the format only in the href path; dropdown-content `!relative` shoves layout; btn-contrast border is !important"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8fe253ae-8ab9-4358-b970-c9133e1103d2
  modified: 2026-08-09T08:12:41.128Z
---

PR #5593 (branch `fix/opds-download-format-filter-5583`), opened 2026-08-09. Adds
`src/services/opds/formats.ts` as the one place that identifies an OPDS acquisition
link's format; `feedChecker.getAcquisitionLink` and `PublicationView` both use it.

**Calibre names the format ONLY in the href path.** Real shape is
`/get/<lowercase fmt>/<id>/<Library>` (e.g. `/get/azw3/56/Calibre_Library`), and Calibre
emits a genuine media type *only for formats it knows*. For KFX there is no mime, so the
path token is the sole signal. Calibre-Web instead uses `/opds/download/<id>/<fmt>/`.
Standard Ebooks' `XHTML` link (`application/xhtml+xml`, href `.../single-page`) has no
extension and no token, so it needs a media-type deny arm. Both arms are load-bearing.

**Classification must be asymmetric.** Drop a link only when its format is *positively
named* as unsupported. `SUPPORTED_BOOK_EXTS`-inversion would kill `/download/book.php?id=1`,
which may well serve an EPUB. Anything unidentifiable stays `unknown` and is kept.

**`!relative` on `.dropdown-content` puts the menu in flow.** In PublicationView that sat
inside a fixed-height column with `justify-between`, so opening the menu shoved the whole
button row **156px up the page** (measured). daisyui's default `absolute` is correct;
`dropdown-end` also silently does nothing while the element is `relative`.
`BookDetailView.tsx` still carries the same `!relative` + dead `delete-menu` class.

**`.btn-contrast` declares `background-color` AND `border` `!important`** (globals.css
~628). Good: it survives the `bg-base-300/50` tint `Dropdown` puts on an open toggle, which
turns a plain `btn-primary` half beige while its sibling stays filled. Bad: a `border-l`
seam colour set on a split button is ignored. Use a `gap-px` hairline between halves
instead of a border.

**`[data-eink] .dropdown-toggle` forces `background-color: transparent !important`**
(globals.css ~652) and wins over `.eink-bordered` on source order, so any Dropdown toggle
loses its fill on e-ink regardless of button class.

**A transparent ghost cannot be split** - the caret half renders as a detached D-shaped
sliver. Give the secondary a soft `!bg-base-200` surface if it needs a caret.

**`.claude/plans` is gitignored** (apps/readest-app/.gitignore:84), so design docs written
there never land in a PR.

`pnpm i18n:extract` also surfaces keys from other people's already-landed work; strip them
before committing to keep a PR scoped. See [[i18n-extract-prunes-keys]].
