---
name: footnote-fb2-span-notes-7564
description: "#7564 Russian (FB2→EPUB) footnotes jumped to the notes page: notes are <span id> wrapping blocks, no backlink; MERGED readest #7622 52353a96e, foliate #177 + #178 (pin 5d096be on fix/footnote-span-note-on-pin)"
metadata:
  node_type: memory
  type: project
  originSessionId: 971a4a2f-b631-4014-9499-e59751aa3646
  modified: 2026-11-18T10:35:27.858Z
---

#7564 (2026-11-16, Android + iOS): tapping `[2]` in Russian books opened the whole "Примечания" section and jumped there. Books from DmitryT79 archived at `~/Documents/books/issues/7564/` (greyhound.epub: `[54]` in ch1-13 → id17; kot-so-shkafa.epub: 7-paragraph note id72 from ch1-6).

- Markup (FB2 converter): `<span id="id17"><div class="title1"><p>54</p></div><p>…</p></span>` straight in `<body>`; ref `<a href="ch2.xhtml#id17" class="a">[54]</a>`, not superscript, no backlink.
- Two causes in foliate `footnotes.js`: `extractFootnote` climbed the inline span to `<body>` and threw; then `check` rejected a note without backlink. On main after #7541 the popup stays hidden but the view still jumps.
- Fix (2026-11-18): an inline element wrapping blocks is the note; `isNumberedInlineNote` accepts it under `check` when it opens with the reference's own number. Limited to inline wrappers so the #7537 `<p>`-without-backlink rejection tests hold. foliate PR #177 MERGED c10b17a (main version differs: main lacks the multi-paragraph `getFootnoteRange`/`FOOTNOTE_START_RE`); readest PR #7622 MERGED 52353a96e (2026-11-18) at pin 5d096be after two more CodeRabbit passes: only the link target counts as wrapper (`isBlockWrapper`), number text joined with spaces only between blocks. foliate #178 (main follow-up) MERGED f4c840823. Declined: chapter wrapped in inline span (hypothetical), popup-undefined-after-reject (before-render precedes load by design).
- The refs are CSS superscripts (`.a { vertical-align: super }`), so `maybe()` is true and `check` never applies in these books; the real fix was `extractFootnote`. I first told the reporter 3-ref paragraphs still jump (from counting refs, without checking computed style); a device tap on `[59]` disproved it and the reply/PR body were corrected. Verified on Xiaomi with main 52353a96e.

**Why:** the worktree's foliate submodule `origin` is the main checkout's `.git/modules` path, not GitHub; `git push origin` there only updates the local mirror. Push foliate branches from `/Users/chrox/dev/readest/packages/foliate-js` (origin = GitHub).
**How to apply:** dev-web Playwright recipe for footnotes: `view.goTo(view.getCFI(index, range-around-link))`, click the link in its frame, read `.footnote-popup foliate-view` body text. See [[footnote-check-superscript-7537]].

Lesson: before claiming a footnote link takes a given path, check `getComputedStyle(a).verticalAlign` in the loaded book; publisher CSS can make a bare `[n]` a superscript.
