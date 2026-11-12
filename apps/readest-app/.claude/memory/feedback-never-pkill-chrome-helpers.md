---
name: feedback-never-pkill-chrome-helpers
description: "Never pkill Chrome helper/renderer processes by name pattern; it crashed every tab in the user's real Chrome (Error code 15). Kill one verified pid only, or ask."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9799d1fd-be18-4894-85ae-ad3c3111bc3e
  modified: 2026-10-31T09:51:33.650Z
---

On 2026-10-31, while recovering a frozen dev-web tab driven through Claude in Chrome, I ran `pkill -f "Google Chrome Helper (Renderer)" -P 0`. Every tab in the user's own Chrome, including GitHub and Claude, then showed "Can't open this page, Error code: 15", and new navigations failed until Chrome was restarted.

**Why:** the extension drives the user's real Chrome. Renderer processes are shared across the user's tabs, so killing them by name kills the user's work as well as the test tab.

**How to apply:** to recover a frozen test tab, first try `tabs_close_mcp`. If that fails, kill only one pid, and only after confirming it is that tab's renderer (for example, the single pegged-CPU helper that appeared when the test tab opened). Never use a name-pattern kill on browser processes, and never restart the user's browser yourself; ask them. Related: [[feedback-bounded-waits]].
