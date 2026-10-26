# Implementation: readness-cli

Status: DRAFT  
Spec: [readness-cli-spec.md](./readness-cli-spec.md)

Implement the agent bridge in three slices. **Slice 3 is this Node/TS package (`readness-cli`).** Slices 1–2 remain in the Readest desktop app (`agent_bridge` + webview handler) and are out of scope for the standalone package, but documented here for the monorepo.

Do not register Reedy tools for this, and do not change `tauri.conf.json` `plugins.cli`.

## Slice 1 — Protocol and listener (Readest app)

Rust, desktop only, started from `apps/readest-app/src-tauri/src/lib.rs` setup beside the single-instance plugin.

- [ ] Add / keep `src-tauri/src/agent_bridge.rs`.
- [ ] Bind `127.0.0.1` on an ephemeral port. Store the bound address.
- [ ] Generate a per-launch secret. Write `port` and `secret` to the app config dir as `agent-bridge.json` with user-only permissions. Overwrite it on each launch.
- [ ] `POST /agent` with `Authorization: Bearer <secret>` and a JSON body. Any other method, path, or secret returns 401 or 404 with an empty body.
- [ ] Reject a missing `id` or `cmd` with HTTP 200 and `{"ok": false, "error": "bad-request"}` so the CLI can map it to exit 2. Malformed JSON is the same error.
- [ ] Emit `agent-request` to the `main` webview and wait up to 30 seconds for `agent-response` with the same `id`. Timeout becomes `{"ok": false, "error": "timeout"}`.
- [ ] Ignore a response whose `id` does not match the in-flight request.
- [ ] Do not log the secret, the request body, or the response body.

### Unit tests (Rust, `agent_bridge` module tests)

- [ ] A listener bound for the test accepts only `127.0.0.1`.
- [ ] `POST /agent` with the correct bearer returns the handler's JSON.
- [ ] Wrong bearer, missing bearer, `GET /agent`, and `POST /other` do not call the handler and return an empty body.
- [ ] Malformed JSON and a body without `id` or `cmd` return `bad-request` and do not call the handler.
- [ ] The response `id` is the request `id`.
- [ ] A handler that never replies produces `timeout` within the test's shortened deadline.
- [ ] A response with a different `id` is ignored and the request still times out.
- [ ] The secret file round-trips `port` and `secret`, and a second start overwrites the file.

## Slice 2 — Webview handler (Readest app)

TypeScript, mounted once for the desktop app while a reader view can exist. The handler calls `useReaderStore.getState().getView` and `librarySearchService`. It does not import Reedy.

- [ ] Add `src/services/agentBridge/protocol.ts` with the request and response types from the spec, and a `dispatch(request, deps)` function that performs no I/O.
- [ ] Add `src/services/agentBridge/host.ts` that listens for `agent-request` and emits `agent-response`. Mount it from the reader shell so `getView` is the live store.
- [ ] Commands: `status`, `context`, `selection`, `search`, `goto`, `open` per the spec.
- [ ] Unknown `cmd` returns `bad-request`. A `--book` hash with no open view returns `book-not-open`. A command that needs a view before it exists returns `view-not-ready`.

### Unit tests (Vitest, `src/__tests__/services/agent-bridge.test.ts`)

Use a fake view and a fake `searchLibraryBooks`. Do not open an EPUB. Cover status/context/selection/search/goto/open error and success paths from the original checklist.

## Slice 3 — `readness-cli` (this package)

A small Node/TypeScript console client. It reads `agent-bridge.json`, sends one `POST`, and prints the response body to stdout. **Not** a Rust `[[bin]]`.

Location options:

- Standalone: this repo / folder (`readness-cli`)
- Monorepo: e.g. `packages/readness-cli` inside Readest

Checklist:

- [x] Subcommands: `status`, `open <path>`, `context`, `selection`, `search <query>`, `goto <cfi>`.
- [x] `search` flags: `--mode`, `--scope`, `--match-case`, `--match-diacritics`, `--nearby-words`, `--limit`.
- [x] Every subcommand accepts `--book <hash>`.
- [x] stdout is the JSON body only. Usage errors go to stderr.
- [x] Exit 0, 2, 3, and 4 as in the spec. Connection refused and a missing secret file are exit 3.
- [x] `open` refuses a non-absolute path and `file://` on the client side.
- [x] Zero runtime dependencies; Node 18+ `fetch`.
- [x] Unit tests for argv building and exit mapping (mocked transport; no live app).

### Unit tests (Node `node:test`)

- [x] `search "黑暗森林" --mode regex --scope section --limit 5 --book abc` builds the spec JSON, including the hash.
- [x] Missing `search` query and missing `goto` CFI exit 4 and do not open a socket.
- [x] `open` with `book.epub` and with `file:///C:/book.epub` exits 4.
- [x] A response body `{"ok": true}` maps to exit 0. `{"ok": false}` maps to exit 2. A transport error maps to exit 3.
- [x] stdout for a success fixture is exactly the response bytes plus a trailing newline, and stderr is empty.

## Remove from Readest

Delete the unused Rust console client so agents use **readness-cli** only:

1. **Delete file:** `apps/readest-app/src-tauri/src/bin/readest-cli.rs`
2. **Edit** `apps/readest-app/src-tauri/Cargo.toml`:
   - Keep `default-run = "Readest"`
   - Remove the entire `[[bin]]` block with `name = "readest-cli"`
   - Update any comment that named `readest-cli` to point at `packages/readness-cli` / Node agent clients
3. **Keep** `apps/readest-app/src-tauri/src/agent_bridge.rs` and its start from `lib.rs`
4. **Edit** comments near `agent_bridge::start` in `lib.rs`: say `readness-cli` / agent clients, not `readest-cli`
5. **Add** design docs under `docs/designs/readness-cli-*.md` (copy from this package)
6. Optionally vendor or workspace-link this package as `packages/readness-cli`

Do **not** remove Slice 1–2 (`agent_bridge`, webview handler). Those are required for the Node client to work.

See also `readest-overlay/REMOVE.md` in this package for a copy-paste cleanup list.

## Done when

- [ ] `cargo test -p Readest agent_bridge` passes (Slice 1, in app).
- [ ] `pnpm test --run src/__tests__/services/agent-bridge.test.ts` passes (Slice 2, in app).
- [x] `npm test` in `readness-cli` passes (Slice 3).
- [ ] With the desktop app running, `readness-cli open` on an absolute EPUB, then `status`, `search`, `goto` of a returned CFI, and `selection`, each print `"ok": true` and exit 0.
- [ ] Rust `readest-cli` binary and `[[bin]]` entry are gone from the Readest checkout.
