---
name: note-popup-markdown-5785
description: "#5785 note bubble popup rendered note.note as raw text (never had markdown in any ref/PR); fix = shared noteMarkdown util + DOMPurify, MERGED #5805 (841b3639b, 2026-08-20); open PR #5780 rewrites the same hunk and must port it"
metadata: 
  node_type: memory
  type: project
  originSessionId: ec8bb638-97e7-446b-918c-77b5a522ae75
  modified: 2026-08-20T17:01:34.284Z
---

Issue #5785 (2026-08-21): the annotation bubble popup (`AnnotationNotes.tsx`) rendered `{note.note}` as a bare text node since #2798, while the sidebar (`BooknoteItem.tsx`) has parsed notes with Marked since #1315 (+ KaTeX since #5571). The user remembered popup markdown being implemented; an exhaustive search (all refs incl. fork remotes, PRs, stashes, worktrees, plans, memory) found NOTHING, so it was a real gap, not a regression.

Fix (**MERGED** as PR #5805, squash `841b3639b` on main, 2026-08-20; worktree and local branch removed):
- New `src/app/reader/utils/noteMarkdown.ts` exports `parseNoteMarkdown` (the sidebar's scoped `Marked({gfm}) + markedKatex({throwOnError:false, output:'mathml', nonStandard:true})`).
- `BooknoteItem.tsx` imports it; `AnnotationNotes.tsx` renders `<div className='prose prose-sm max-w-none' dangerouslySetInnerHTML>`.
- Test: `src/__tests__/components/annotator/AnnotationNotesMarkdown.test.tsx` (h1/li/p/math/vertical) + `src/__tests__/app/reader/utils/noteMarkdown.test.ts` (sanitizer). Full vitest + lint green. Browser-verified on web (horizontal + vertical-rl books).
- Follow-up commit after Codex adversarial review: `parseNoteMarkdown` output goes through DOMPurify `USE_PROFILES {html, mathMl}` + `FORBID_TAGS style/form/input/button/textarea/select` (sidebar had stored XSS via imported notes since #1315; `sanitizeHtml` strips MathML so it was NOT reused); popup memoizes parsed HTML. `Marked#parse` needs `{ async: false }` to type as `string`.
- STILL OPEN (pre-existing, flagged in PR): markdown links in notes navigate the whole Tauri webview (lib.rs navigation handler only blocks alipay); fix = delegate anchor clicks + `openUrl`.

**Why:** `prose` colors are theme-aware via daisyUI (`--tw-prose-body: oklch(var(--bc)/0.8)`), so no color overrides are needed; `max-w-none` keeps vertical-rl `minWidth: max-content` behaviour (prose caps width at 65ch).

**How to apply:** Open PR #5780 ([[pr-5780-inline-note-popup-edit-review]]) replaces the whole popup card block with `AnnotationNoteItem.tsx`, which still renders `{note.note}` raw; whichever merges second must port the prose render into `AnnotationNoteItem`. The old "Mirrored in __tests__/utils/md-note.test.ts" comment was stale (test deleted in 171c6de9a). Side observation: the Notebook panel showed "no notes yet" right after saving a note in dev-web, unverified whether pre-existing.


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5785 note popup markdown](note-popup-markdown-5785.md) MERGED #5805; `noteMarkdown` util, DOMPurify html+mathMl; OPEN: note links navigate the whole webview (pre-existing)
