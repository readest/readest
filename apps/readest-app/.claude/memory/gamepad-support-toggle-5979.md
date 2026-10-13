---
name: gamepad-support-toggle-5979
description: "#5979 Steam Deck double inputs: Settings > Behavior > Device > Gamepad Support toggle; MERGED #6027; toggle only, no remapping"
metadata:
  type: project
---

**#5979 (FR: Gamepad Toggle / Remap)** — Readest's `useGamepad` replays a controller's
buttons/sticks as synthetic `KeyboardEvent`s. On a Steam Deck (Flatpak) Steam Input already
binds the same buttons to keys, so every press lands **twice** (one press turns two pages).
The reporter also saw the SteamOS overlay take double inputs while Readest was open.

**MERGED #6027** as b12932da9 on 2026-09-02. Not verified on an actual Steam Deck; the gate
was proved in a browser with a synthetic event (recipe below), never with a real controller.

**Why:** the gate has to sit in `ReaderContent.tsx` because that is the only consumer of
*both* gamepad hooks (`useGamepad` + `useAndroidGamepadConnection`); gating one alone leaves
the other running. And it must read the store, not the `settings` prop, or the toggle would
need a reload.

**How to apply:**
- Setting is `SystemSettings.gamepadEnabled`, default `true` in `DEFAULT_SYSTEM_SETTINGS`.
  No migration: `loadSettings` spreads the defaults *under* saved settings.
- `ReaderContent.tsx` reads it as `useSettingsStore((s) => s.settings.gamepadEnabled) !== false`.
  The `!== false` covers the pre-load window where the store holds `{} as SystemSettings`.
  Primitive selector + `saveSysSettings`'s `setSettings` = live toggle, no reload; `useGamepad`'s
  cleanup cancels the rAF loop and drops the `gamepadconnected`/`gamepaddisconnected` listeners.
- Row is `SettingsSwitchRow` in ControlPanel's Device `BoxedList`, unconditional (controllers
  exist on desktop, web, Android, iOS). Registered in `commandRegistry.ts` or settings search
  misses it - see [[settings-scope-menu-5933]].
- **Scope was deliberately the toggle only.** The issue also asks for remapping; skipped
  because Steam Input and desktop remappers own that once Readest stops competing, and the
  reporter said the toggle alone covers most cases. Remapping is still open if anyone asks.

**Verify trick:** no controller needed. Spy on the handler, dispatch a synthetic
`new Event('gamepadconnected')` on `window`, and check whether anything fires. Toggle from the
reader's own settings dialog to prove it takes effect without a reload.
