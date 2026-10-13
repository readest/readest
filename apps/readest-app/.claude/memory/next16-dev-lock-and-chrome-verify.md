---
name: next16-dev-lock-and-chrome-verify
description: "Verifying web changes in Chrome — Next 16 allows ONE `next dev` per checkout (.next/dev/lock); a Tauri-mode `pnpm dev` on 3000 blanks the page in a browser; the sandboxed Bash cannot reach loopback"
metadata: 
  node_type: memory
  type: project
  originSessionId: 14642481-059b-43ef-b527-ce013bc95023
  modified: 2026-09-18T15:15:25.559Z
---

Chrome verification of the web app (2026-09-18) hit three environment traps.

**Next 16 single dev server per checkout.** `next dev` writes `.next/dev/lock`
(`{pid, port, ...}`) and a second `next dev` in the same directory exits 1 with
"Another next dev server is already running", regardless of `PORT`. Do NOT delete
the lock while the other server lives: both would share `.next/dev`. Escape
hatches: use the running server if it is the right mode, `pnpm build-web` +
`next start -p 3001` (prod build, no lock), or a `pnpm worktree:new` checkout.

**`pnpm dev` (Tauri mode) on port 3000 is unusable from Chrome.** It loads
`.env.tauri` (`NEXT_PUBLIC_APP_PLATFORM=tauri`), so `/library` renders blank
with the Next overlay error "Cannot read properties of undefined (reading
'metadata')" from `getCurrentWindow()` in settingsSync. Check the owner first:
`cat .next/dev/lock` then `ps -E -o command -p <pid> | tr ' ' '\n' | grep APP_PLATFORM`.
Another Claude session (shell-snapshot zsh parent) may own it — leave it alone.

**The Bash tool sandbox blocks loopback.** `curl localhost:3000` returns `000`
instantly even while Chrome loads the same page. Probe with Chrome, or pass
`dangerouslyDisableSandbox` for a loopback probe. Servers started with
`nohup … &` from a foreground Bash call die when the call's tree is torn down;
`run_in_background` is the one that kept a server alive.

**One Chrome window intercepts loopback.** Tabs whose ids start 17252971xx (a
second profile/window the extension sometimes picks) show an error page for
`localhost`/`127.0.0.1` while curl gets 200; the LAN address from Next's
"Network:" line (`http://192.168.2.120:<port>/library`) loads fine there. That
profile has an empty, signed-out library.

**Chrome extension tab groups reset often** ("not in Claude's tab group",
"Couldn't determine which page"): re-run `tabs_context_mcp` and re-navigate.
The web file picker creates its `<input type=file>` on click and never attaches
it, so `file_upload` needs a `HTMLInputElement.prototype.click` patch that
appends the input to the DOM first.

**Why:** an hour of the #6198 session went to diagnosing servers that "were
listening" but refused connections; the real causes were the lock and the
other session's Tauri server.
**How to apply:** before `pnpm dev-web`, check `.next/dev/lock`; verify pages in
Chrome, never with sandboxed curl.
