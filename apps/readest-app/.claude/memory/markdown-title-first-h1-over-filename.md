---
name: markdown-title-first-h1-over-filename
description: "md import titled the book after the first <h1> instead of the file; reported as Windows/iOS but universal — reproduced on web"
metadata:
  node_type: memory
  type: project
  originSessionId: dbb26dd1-4bc2-4e26-935c-a7b1f1d9d496
  modified: 2026-08-12T15:25:51.228Z
---

PR #5653, opened 2026-08-12. Importing a `.md` file names the book after the first line
of the content, not the file. Repro file `~/Documents/books/issues/demo.md`
(first line `# 按顺序总结`) imported as **按顺序总结**, not "demo".

**The "Windows and iOS" framing is wrong — it is universal.** Reproduced in
Chrome against `pnpm dev-web`. There is no native markdown path: `.md` never
reaches Rust and never converts to EPUB (unlike `.txt`), so
`DocumentLoader.isMd()` -> `makeMarkdownBook` in `src/utils/md.ts` is the only
code that titles a markdown book, on every platform. "Sometimes" just means
"when the file has an `<h1>` anywhere".

Cause was the title chain in [[markdown-md-support-774]], present since #4816:
`frontmatter.title || first <h1> || filename`. Fixed to
`frontmatter.title || filename` — a heading is body content; only frontmatter is
metadata. Note the old lookup was `headingEls.find(h => h.tagName === 'H1')`,
i.e. by tag name and not position, so an `<h1>` buried mid-document won even
when the file opened with an `<h2>`.

**Existing libraries are unaffected**, which is why the fix is safe despite
`metaHash` = `title|authors|identifier` (identifier for md = `file.name`, see
[[markdown-yaml-frontmatter-5279]]). Re-importing the same file matches on the
content `hash` first, and that branch in `bookService.importBook` preserves
`existingBook.title`; only the metaHash branch overwrites it. Reopening is also
stable: the stored copy is `<hash>/<safeTitle>.md`, so re-deriving the title
from that filename returns the title the book already had.

**Why:** the fix looks like it should renumber every md book in every library,
and it does not.

**How to apply:** when import-titling tests need a *new* book rather than an
update, changing bytes at the END of the file is not enough — `partialMD5`
matched a 15 KB md file with an appended line to the original and folded the
import into the existing book. Alter bytes near the START to force a distinct
hash.

Browser repro recipe (see [[browser-verify-readest-web-recipe]]): the web file
picker builds its `<input type=file>` on demand so there is nothing to target;
drive imports instead by copying the file into `public/`, fetching it in-page,
and dispatching a synthetic `DragEvent('drop')` with a `DataTransfer` at
`.library-page` — `useDragDropImport` listens there and only reads
`dataTransfer.files`.
