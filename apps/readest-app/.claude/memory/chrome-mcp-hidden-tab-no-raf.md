---
name: chrome-mcp-hidden-tab-no-raf
description: "The Claude-in-Chrome MCP tab often reports visibilityState \"hidden\" (no rAF, no scroll events, AppleScript sees 0 Chrome windows); check before trusting a reader repro, and probe with renderer.goTo which needs neither"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5f01dea0-ac7c-4ef2-8c5c-58a60be6cc8b
  modified: 2026-09-07T17:52:11.603Z
---

On 2026-09-08 the MCP-controlled Chrome tab loaded the reader but `document.visibilityState` was `hidden`, `requestAnimationFrame` never fired, and programmatic `scrollTop` writes produced no `scroll` events. `osascript` reported 0 windows for Google Chrome and `resize_window` did not change `innerWidth`. Clicking in the tab, `activate`, and resizing did not help; the tab only became visible later (chrox brought the window forward).

**Why:** readest's relocate commit runs in rAF unless hidden, and foliate's scrolled-mode relocate rides the container `scroll` event; both are dead in a hidden tab, so "no relocate / no progress" can be the tab, not the bug.

**How to apply:** first thing in any reader repro, run `({v: document.visibilityState, raf: await Promise.race([...])})`. If hidden, either ask chrox to bring the window forward or probe with `foliate-view.renderer.goTo({index, anchor})` and read `view.lastLocation`, which are synchronous and need neither rAF nor scroll events. Remember every live `goTo` auto-pushes progress to the cloud after 3s.
