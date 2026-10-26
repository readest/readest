# readness-cli

Node/TypeScript console client for the running [Readest](https://github.com/readest/readest) desktop app.

One command → one JSON `POST` to the loopback agent bridge → one JSON document on stdout. Built for agents that need to open a book, search, jump to a CFI, or read the current selection.

## Requirements

- Node.js 18+
- Readest desktop app running (it writes `agent-bridge.json` and listens on `127.0.0.1`)

## Install / run

```bash
cd readness-cli
npm install
npm run build
node dist/cli.js status
# or after npm link / path install:
npx readness-cli status
```

Development without a prior build:

```bash
npx tsx src/cli.ts status
```

## Commands

| Command                | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `status`               | List open books and `viewReady`                          |
| `open <absolute-path>` | Open an EPUB (absolute path only; no `file://`)          |
| `context`              | Current CFI, chapter, page, selection snapshot           |
| `info`                 | Book metadata + flattened TOC with CFIs (no view needed) |
| `selection`            | Current selection text + CFIs, or `null`                 |
| `search <query>`       | In-book search (`--mode`, `--scope`, `--limit`, …)       |
| `goto <cfi>`           | Navigate to an EPUB CFI                                  |

Global: `--book <hash>` targets a specific open book.

Examples:

```bash
readness-cli open "C:\Users\user\Documents\book.epub"
readness-cli status
readness-cli search "黑暗森林" --mode contains --limit 20
readness-cli goto 'epubcfi(/6/14!/4/2,/1:10,/1:14)'
readness-cli selection --book 865b8068…
readness-cli info
readness-cli info --book 865b8068…
```

## Exit codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | App answered `{"ok": true, …}`                             |
| 2    | App answered `{"ok": false, "error": …}`                   |
| 3    | Bridge missing, connection refused, or unreadable response |
| 4    | Invalid argv                                               |

stdout is the JSON body plus a trailing newline. Diagnostics go to stderr.

## Bridge file

| Platform | Path                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Windows  | `%APPDATA%\com.bilingify.readest\agent-bridge.json`                         |
| macOS    | `~/Library/Application Support/com.bilingify.readest/agent-bridge.json`     |
| Linux    | `$XDG_CONFIG_HOME/com.bilingify.readest/agent-bridge.json` or `~/.config/…` |

Override the config root with `READNESS_CONFIG_DIR` (tests).

## Package layout

- `src/cli.ts` — argv + main
- `src/request.ts` — build JSON request from args
- `src/transport.ts` — read bridge file + HTTP POST
- `src/bridgePath.ts` — platform config path
- `src/exit.ts` — classify response → exit codes

Wire protocol matches Readest `agent_bridge` (Slice 1–2 in the app). This package is Slice 3 only.

## Tests

```bash
npm test
```

## Docs

- [Spec](docs/designs/readness-cli-spec.md)
- [Implementation](docs/designs/readness-cli-implementation.md)
