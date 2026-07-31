---
name: ambient-mode-light-sensor-5394
description: "PR #5394 Ambient Mode (theme follows Android light sensor) - emitOrQueue is one-shot-only, void async subscription toggles must be chained, themeStore and getThemeCode must agree on defaults"
metadata: 
  node_type: memory
  type: project
  originSessionId: a8dd2e8e-ecda-4515-9960-99752f296867
  modified: 2026-07-31T15:51:57.037Z
---

PR #5394 (merged 2026-07-31 as `bbad27adf`) added a fourth `ThemeMode`,
`'ambient'`, that flips light/dark from the Android ambient light sensor.
Contributed as "Match Surroundings"; renamed to Ambient Mode before merge
(value, identifiers, label, and all 33 locales). Android-only — iOS/desktop
stubs report unavailable.

Four defects found in review, all fixed in the same PR:

**`emitOrQueue` is for one-shot events only.** `NativeBridgePlugin.kt` has
`emitOrQueue` + `pendingEvents` + an overridden `registerListener` that
replays. It exists so a cold-launch `shared-intent` survives until JS calls
`addPluginListener`. The queue has **no cap and no eviction**. Routing a
continuous stream (sensor samples) through it grows unbounded whenever the
native source outlives the JS listener — the start/stop gaps, and forever
after a WebView renderer death (READEST-P `onRenderProcessGone`) — then
replays the whole backlog in one burst. Use `triggerEvent` directly for
streams; dropping a sample nobody is listening for is correct.

**`void`-fired async start/stop on a shared subscription must be chained.**
Both spanned several awaits and were fired with `void` from two places
(`setThemeMode` and `visibilitychange`). A stop landing after a start left
the sensor off while the store still believed it was listening — theme
frozen, and the `if (listening) return` guard blocked recovery. Two starts
overwrote the `PluginListener` and leaked the first. Fix: one module-level
`Promise` that every transition chains onto.

**`getThemeCode()` reads localStorage independently of themeStore.** They
must agree on defaults or the app chrome and the book content diverge —
here the store seeded `ambientIsDarkMode` from the system appearance while
`getThemeCode` defaulted it to `false`. Fixed with a shared
`readStoredAmbientIsDarkMode` helper in `utils/ambientLight.ts`. Same class
of bug as any other localStorage key those two both read.

**`initSystemThemeListener` runs *after* `appService.init()` has resolved.**
`EnvContext` only calls `setAppService` once `getAppService()` (which awaits
`init()`) resolves, and `Providers.tsx` guards on `if (appService)`. So every
`has*` capability flag is already final there — a re-probe is a redundant IPC
per launch, not a fix for an ordering problem.

Related: [[bug-patterns]], [[sentry-crash-reporting-4914]]
