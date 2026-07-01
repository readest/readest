---
name: markdown-md-support-774
description: Markdown (.md) reading via in-memory foliate book (no EPUB); split-at-H1; foliate book-object contract gotchas
metadata: 
  node_type: memory
  type: project
  originSessionId: a82e979b-0edb-4964-91fd-3677ecfe5679
---

Issue #774: render standalone `.md` files at runtime (NO EPUB conversion). **MERGED as
PR #4816** (branch `feat/markdown-support`). Built test-first via `/autoplan` (CEO+Eng
dual-voice review). Suite green (6365), lint + format clean; live-verified in web app
(import via drop, split TOC, cross-section nav, GFM rendering, pagination).

**Where:** `src/utils/md.ts` `makeMarkdownBook(file)` builds an in-memory foliate book
modeled on `packages/foliate-js/fb2.js`. Routed in `src/libs/document.ts` `open()` via
`isMd()` **before `isTxt()`** (a `.md` served as `text/plain` would otherwise hit TXT→EPUB).
`'md'` added to `SUPPORTED_BOOK_EXTS` (constants.ts). `sanitize.ts` `sanitizeHtml` gained
`'class'` (code `language-*` theming) + `del`/`ins` tags. Pipeline: strip YAML frontmatter →
`marked`(gfm) → `sanitizeHtml` → split at `<h1>` (preamble = pre-first-H1 content) → nested
heading-outline TOC.

**Non-obvious foliate book-object contract (cost us the CRITICAL review finding):**
- `section.id` and `splitTOCHref()` output MUST be the SAME type. readest nav
  (`services/nav/index.ts:133`) does `new Map(sections.map(s=>[s.id,s]))` then `.get(sectionId)`
  where sectionId = `splitTOCHref(href)[0]`. `SectionItem.id` is typed `string`, so use
  STRING ids + `splitTOCHref => href.split('#')`. fb2.js uses numbers consistently (works
  only because it's untyped JS); do NOT copy fb2's `Number(x)`.
- Fragment CFIs / TOC sub-anchors require `section.loadText` (nav skips sections without it,
  index.ts:153). Provide it.
- `SectionItem.cfi` is non-optional → set `cfi: ''` (foliate falls back to `CFI.fake.fromIndex`).
- `createDocument()` parses `application/xhtml+xml`; marked's HTML5 void tags (`<br><hr><img>`)
  are parse errors there → serialize sections with `XMLSerializer` (not innerHTML). `load()`
  and `createDocument()` must derive from the SAME string (CFI round-trip).
- `resolveHref` returns `null` for unresolved anchors (never index 0). jsdom lacks
  `URL.createObjectURL` → `load()` is lazy + tests stub it.

**Deferred follow-ups (open issues):** relative image resolution (web File-objects have no
sibling access — needs the bundle model); Markdown folder/zip "package" model; footnotes/math/
Mermaid/wikilinks; syntax-highlight token colors. Plan: `.claude/plans/2026-06-26-markdown-md-support-774.md`.
