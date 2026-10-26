# Spec: readness-cli

Status: DRAFT  
Product: **readness-cli** (Node/TypeScript console client)  
Audience: an agent that needs to search an open book, jump to a passage, and read the current selection.

## Problem

`readest.exe` accepts up to four positional file paths (`file1`–`file4` in `apps/readest-app/src-tauri/tauri.conf.json`) and nothing else. Measured against Readest 0.12.16 on Windows, with the app already running:

- The process is a GUI binary (PE subsystem 2). `--help`, `-h`, `--version`, and `-V` print nothing and exit 0.
- A second launch is swallowed by the single-instance plugin. The new process exits 0. The running window receives the argv.
- The webview uses only `args[1]` (`useAppUrlIngress`). A second path is ignored. A flag such as `--help` is treated as a file path and logged as an asset-protocol error.
- An absolute path opens the book. `SanTiZhongDeWuLiXue.epub` changed the window title to `Readest - 《三体》中的物理学`.
- A `file:///` URL is rewritten to a path with a leading slash (`/C:/...`) and rejected.
- A bare filename is resolved by the running app, not by the caller's working directory, and fails with `File does not exist`.
- A missing path logs `File does not exist` and drops the window title back to `Readest`.

There is no stdout channel, so an agent cannot receive search hits, a CFI, or the selection. The reader operations that would serve those requests live in the webview (`useReaderStore.getView`, `librarySearchService`, `FoliateView.goTo`). Rust cannot call them.

## Decision

Add a **Node/TypeScript** console program, **`readness-cli`**, that sends one JSON request to the running desktop app and prints one JSON object to stdout. Leave the existing file-open CLI unchanged.

```text
readness-cli  →  127.0.0.1 + per-launch secret  →  Rust agent_bridge listener
              →  Tauri event to the webview  →  reader handler  →  JSON reply
```

**Why Node/TS (not a Rust `[[bin]]`):** agents and scripts already run Node; there is no Rust toolchain requirement; the client is a thin HTTP caller that can live as its own package (`readness-cli` / `packages/readness-cli`) without compiling into the GUI app.

CFI (EPUB Canonical Fragment Identifier) is the location the CLI returns and accepts. Page numbers move when the font or window changes. A CFI does not.

The former Rust binary `readest-cli` is **removed** from the Readest tree; see [implementation — Remove from Readest](./readness-cli-implementation.md#remove-from-readest).

## Non-goals for v1

- Semantic search (`lookupPassage` / Reedy). It needs an index and answers a different question.
- Highlights, notes, and the Reedy memory tools. Those write.
- Changing `readest.exe` argv parsing, deep-link parsing, or the file-open CLI.
- Web and mobile. The listener is desktop-only.
- Driving the window through the Chrome DevTools Protocol. `pnpm cdp` exists only for the Linux CEF dev build.

## Security

- Bind `127.0.0.1` only. Refuse any other address.
- Every request carries a per-launch secret, the same idea as `src-tauri/src/media_proxy.rs`. The secret is generated when the listener starts and is readable only by the local user. `readness-cli` reads it from that file. A request with the wrong or missing secret gets HTTP 401 and an empty body.
- The listener does not fetch URLs and does not accept a path outside `open`.
- `open` accepts only an absolute path that exists and is a file. No `file://`, no bare name, no directory. The CLI also refuses relative paths and `file://` client-side.
- v1 commands are read and navigate. None of them create highlights, notes, or library records beyond what the existing absolute-path open already does.

## Process and output

`readness-cli` is a console program (Node ESM). It writes one JSON document to stdout and nothing else. Diagnostics go to stderr. It exits after one request.

| Exit | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | `{"ok": true, ...}`                                 |
| 2    | The app answered with `{"ok": false, "error": ...}` |
| 3    | Nothing is listening, or the secret file is missing |
| 4    | The command line itself is invalid                  |

The app being open is not success. Success is a JSON body with `"ok": true`.

## Protocol

`POST http://127.0.0.1:<port>/agent` with header `Authorization: Bearer <secret>` and a JSON body:

```json
{
  "id": "1",
  "cmd": "search",
  "query": "dark forest",
  "mode": "contains",
  "scope": "book",
  "limit": 20
}
```

`id` is echoed back so a caller can match logs. The listener forwards the body to the webview as `agent-request` and waits for `agent-response` with the same `id`. The wait is 30 seconds. On timeout the CLI exits 2 with `"error": "timeout"`.

The listener speaks HTTP/1.1 only so the CLI can use the platform HTTP stack (Node `fetch`). One request per connection is enough.

### Bridge file location

| Platform | Path                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Windows  | `%APPDATA%\com.bilingify.readest\agent-bridge.json`                                                               |
| macOS    | `~/Library/Application Support/com.bilingify.readest/agent-bridge.json`                                           |
| Linux    | `$XDG_CONFIG_HOME/com.bilingify.readest/agent-bridge.json` or `~/.config/com.bilingify.readest/agent-bridge.json` |

## Commands

Global flag: `--book <hash>`. When omitted, the handler uses the book whose view is focused. When the hash does not match an open view, the response is `"error": "book-not-open"`.

### `status`

No body fields beyond `cmd`.

```json
{
  "ok": true,
  "running": true,
  "books": [
    { "hash": "865b8068…", "title": "《三体》中的物理学", "viewReady": true }
  ]
}
```

`viewReady` is false until `getView(bookKey)` returns a view that has finished `init`.

### `open`

```json
{
  "cmd": "open",
  "path": "C:\\Users\\user\\Documents\\obsidian-notes\\Attachments\\Books\\SanTiZhongDeWuLiXue.epub"
}
```

```json
{
  "ok": true,
  "hash": "865b8068033e91747c6aa06254e119f5",
  "title": "《三体》中的物理学",
  "viewReady": false
}
```

`open` reuses the absolute-path open used by the single-instance file handoff. It does not wait for pagination. `viewReady: false` means the caller should poll `status` before `search`, `context`, `selection`, or `goto`.

Errors: `"not-absolute"`, `"not-found"`, `"not-a-file"`.

### `context`

Reads the same snapshot shape as `ReadingContextSnapshot` in `src/services/reedy/tools/builtins/types.ts`.

```json
{
  "ok": true,
  "cfi": "epubcfi(/6/14!/4/2/1:0)",
  "sectionIndex": 3,
  "chapterTitle": "第3章",
  "pageNumber": 16,
  "selection": null
}
```

`pageNumber` is Readest's existing 1500-characters-per-page figure. It is informational. `goto` does not accept it.

Errors: `"view-not-ready"`.

### `selection`

```json
{
  "ok": true,
  "selection": {
    "text": "黑暗森林",
    "startCfi": "epubcfi(/6/14!/4/2,/1:10,/1:14)",
    "endCfi": "epubcfi(/6/14!/4/2,/1:14,/1:14)"
  }
}
```

When nothing is selected, `"selection": null` and `"ok": true`.

Errors: `"view-not-ready"`.

### `info`

Document facts, independent of the reading position. Unlike `context`, `info`
does **not** require a ready view: metadata and the TOC are parsed when the book
is opened, so a still-loading view still answers.

```json
{
  "ok": true,
  "id": "1",
  "hash": "865b8068033e91747c6aa06254e119f5",
  "title": "《三体》中的物理学",
  "author": "李淼",
  "format": "EPUB",
  "language": "zh",
  "publisher": "湖南科学技术出版社",
  "identifier": "9787571001483",
  "filePath": "C:\\…\\SanTiZhongDeWuLiXue.epub",
  "totalSections": 12,
  "toc": [
    { "label": "第一章", "cfi": "epubcfi(/6/2!/4/2)", "depth": 0 },
    { "label": "1.1 节", "cfi": "epubcfi(/6/4!/4/2)", "depth": 1 }
  ]
}
```

`toc` is flattened; `depth` carries nesting, so a client can rebuild the tree or
filter `depth === 0` for top-level chapters. `cfi` is `null` for an entry the
document could not resolve. `toc` is `null` — never an empty array — when the
document exposes no TOC, so "no TOC" stays distinguishable from "unparsed".
`identifier` prefers `isbn` and falls back to `identifier`.

Errors: `"book-not-open"`.

Because TOC entries carry CFIs, `info` + `goto` is how a client reaches a named
chapter without inventing a CFI or reasoning about page numbers (renderer-derived,
and not stable across font or window size).

### `search`

Uses the in-book path in `SearchBar`: `createLibrarySearchSession`, `searchLibraryBooks` for the open book, then `resolveSearchResultCfis`. `FoliateView.search()` is only the highlight replay and is not the search engine.

```json
{
  "cmd": "search",
  "query": "黑暗森林",
  "mode": "contains",
  "scope": "book",
  "matchCase": false,
  "matchDiacritics": false,
  "nearbyWords": 5,
  "limit": 20
}
```

| Field                          | Rule                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `query`                        | Required, 1–500 characters. CJK may be one character. A non-CJK query shorter than 2 characters returns `"query-too-short"`. |
| `mode`                         | `contains` (default), `whole-words`, `regex`, `nearby-words`.                                                                |
| `scope`                        | `book` (default) or `section`. `section` uses the current section. If progress is not ready yet, search the whole book.      |
| `matchCase`, `matchDiacritics` | Default false.                                                                                                               |
| `nearbyWords`                  | Used when `mode` is `nearby-words`. Default is the app's `DEFAULT_NEARBY_WORDS`.                                             |
| `limit`                        | Default 20, maximum 100. Extra hits are dropped and `"truncated": true`.                                                     |

```json
{
  "ok": true,
  "truncated": false,
  "hits": [
    {
      "cfi": "epubcfi(/6/14!/4/2,/1:10,/1:14)",
      "cfis": null,
      "sectionLabel": "第3章",
      "excerpt": { "pre": "所谓", "match": "黑暗森林", "post": "法则" }
    }
  ]
}
```

Errors: `"invalid-regex"`, `"nearby-needs-two-words"`, `"query-too-long"`, `"view-not-ready"`, `"search-failed"`.

### `goto`

```json
{ "cmd": "goto", "cfi": "epubcfi(/6/14!/4/2,/1:10,/1:14)" }
```

```json
{ "ok": true, "navigated": true }
```

Calls `getView(bookKey).goTo(cfi)`. A CFI the view cannot resolve returns `"ok": true, "navigated": false, "reason": "unresolved"`. A view that is not ready returns `"error": "view-not-ready"`.

`cfi` is required and must be a non-empty string. The CLI does not accept a page number or a fraction in v1.

## Error body

Every failure from the app uses this shape and exit code 2:

```json
{ "ok": false, "error": "view-not-ready", "id": "1" }
```

`error` is one of the codes named above. No stack traces and no file contents in the body.
