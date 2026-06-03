---
name: txt-author-recognition-4390
metadata: 
  node_type: memory
  type: project
  originSessionId: f151827f-0bf2-4307-ac92-e6077df54d19
---

Issue #4390: imported Chinese web-novels showed author either **missing (未知)** or
as an **irrelevant metadata blob** (e.g. `2024/08/01发表于：是否首发：是字数1023150字116:01`).

**Key debugging tell:** the displayed *title* was the **entire filename** including
`作者：X` (e.g. `【月如无恨月长圆】（1-154）作者：陈西`). A real EPUB's `dc:title` would
be just the book name. Full-filename title ⇒ the file went through Readest's
**TXT→EPUB converter** (`bookService.ts` `/\.txt$/` → `TxtToEpubConverter`), which
sets `bookTitle = base filename` in the no-`《》` branch of `extractTxtFilenameMetadata`.
So "EPUB format" books can still be TXT-origin — check `src/utils/txt.ts`, not foliate-js,
when title looks like a filename. (Native Rust EPUB parser #4369 was NOT shipped in 0.11.2.)

Two root causes in `src/utils/txt.ts`:
1. `extractTxtFilenameMetadata` only pulled an author from `《》`-wrapped names; `【】`
   names (the web-novel norm) got no filename author.
2. Greedy header capture `/[【\[]?作者[】\]]?[:：\s]\s*(.+)\r?\n/` grabbed a whole noisy
   metadata line as the author.

Fix:
- `parseLabeledAuthor(base)` extracts the labeled `作者：X` from ANY filename; title stays
  the full name. Only the *labeled* form is safe on a full filename — a bracketed/bare
  fallback would mistake a leading `【title】` for the author.
- `isPlausibleAuthorName()` rejects a header match that looks like a blob (contains `:`/`：`,
  a `\d{4,}` run, or length > 20) → falls back to the filename author. Applied in BOTH
  `convertSmallFile` and `extractAuthorAndLanguage` (large-file path).

Note: the `著` form is handled for file *content* headers but NOT for filenames (kept minimal).
Reported files were 455 kB / 1.25 MB → both under the 8 MB `LARGE_TXT_THRESHOLD_BYTES`
(`convertSmallFile` path). Tests live in `txt-converter.test.ts` (faithful repro of both
reported strings). Related: [[bug-patterns]].
