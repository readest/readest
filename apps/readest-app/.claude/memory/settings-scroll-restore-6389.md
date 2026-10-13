---
name: settings-scroll-restore-6389
description: "PR #6389 Settings scroll restore reworked; OverlayScrollbars defer internals, StrictMode trap, and hidden-Chrome-tab rAF stall with the headless Playwright workaround"
metadata:
  node_type: memory
  type: project
  originSessionId: ba13fd5c-c297-44d0-ae5a-f5264cd9cce4
  modified: 2026-09-28T10:16:08.906Z
---

PR #6389 (external author WantenMN) got a chrox-requested rework (fc723e4fb), MERGED 2026-09-28 as 048babd9c. Chrome-verified: restore, tab-switch reset, hidden-tab pending reveal.

- overlayscrollbars-react renders `[data-overlayscrollbars-contents]` immediately. With `defer` (requestIdleCallback then rAF), OS later stamps `data-overlayscrollbars-viewport` on that SAME element. Before init, the `-initialize` host scrolls natively and the contents element has scrollHeight 0.
- The dev server runs `reactStrictMode: true`, so a "first run" ref breaks restore-on-mount. Save the position in effect cleanup instead.
- The Chrome MCP tab reported `visibilityState: hidden`, so rAF never fired and OS never initialized. Verify with headless Playwright instead: `NODE_PATH=<worktree>/node_modules/.pnpm/playwright@1.60.0/node_modules node script.cjs` against `pnpm dev-web -p <port>`.
- `pnpm worktree:new <PR>` rebased the branch again (see [[worktree-new-rebases-pr-force-push]]). Stash, check out the real head, pop, then push.
