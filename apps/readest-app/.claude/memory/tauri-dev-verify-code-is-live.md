---
name: tauri-dev-verify-code-is-live
description: Before trusting a macOS dev-app verification, prove the webview runs the edited code with a console marker; a window started while the dev server was down kept serving old code
metadata:
  type: feedback
---

2026-10-05, group-scoped content search verify: the wrapper-launched dev app
(see [[computer-use-tauri-dev-binary-no-bundle-id]]) came up blank because the
`next dev` that `tauri dev` started died with it. After restarting the server
and Cmd+R, the page rendered but kept running the OLD Bookshelf. The search
still covered the whole library and a temporary `console.log` never fired, so
I reported a working fix as broken. Quitting and relaunching the app loaded the
new code, and the marker fired at once.

**Why:** the dev binary loads `devUrl` through `tauri://localhost`, so
`location.origin` can't tell dev code from a stale bundle.

**How to apply:** start the dev server first, then launch the app. Before
reading any result, confirm a marker log in Web Inspector (right-click >
Inspect Element > Console). Paste console commands with write_clipboard +
cmd+v, because typed text gets mangled by autocomplete. A non-3000 dev origin
starts logged out and redirects to Sign in; don't enter credentials.
