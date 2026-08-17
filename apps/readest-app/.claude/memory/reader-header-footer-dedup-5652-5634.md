---
name: reader-header-footer-dedup-5652-5634
description: "#5652 + #5634 were one bug — the header gated on width while FooterBar forced the mobile bar on tablet portrait; fix = shared isForcedMobileLayout()"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8af7206-a4f1-42d4-81f5-51d3c99767b7
  modified: 2026-08-14T16:19:13.206Z
---

MERGED as PR #5708 (`fb684ab60`), closing **#5652** (Font & Layout button opened the
last panel) and **#5634** (two TOC buttons on iPadOS). Both were the same defect.

**Root cause.** `HeaderBar` gated its buttons on viewport width alone (`hidden sm:flex`),
while `FooterBar` independently forced the *mobile* footer bar on tablets held portrait.
On an iPad in portrait both bars rendered their own copy of the same control. The
`forceMobileLayout` expression was hand-copied in three files and the header never had it.

**Fix.** `isForcedMobileLayout(isMobileApp?)` in
`src/app/reader/utils/mobileLayout.ts`, adopted by `HeaderBar`, `FooterBar`,
`TTSMiniPlayer` and `TabNavigation` so they cannot drift apart again.

**Decisions chrox made (differ from what the issue reporter proposed):**

- The view menu entry is renamed `Font & Layout` -> `Settings` and **keeps** remembering
  the last panel. `requestedPanel` is deliberately NOT used to pin it to Font.
- `SettingsToggler` is **deleted on every platform**, not just mobile. Desktop and
  tablet-landscape therefore have **no one-click settings entry** — `DesktopFooterBar` is
  navigation + TTS only. They go through the hamburger, `Shift+F`/`Ctrl+,`/`Cmd+,`, or
  the command palette. Accepted knowingly; revisit if it feels thin.
- The quick Font tab got **no** new typography controls, only a `More Settings` button
  that deep-links to the Font panel via `requestedPanel`.
- The view-menu Settings entry must be **byte-identical to the library's**
  (`SettingsMenu.tsx`): `<MenuItem label={_('Settings')} Icon={PiGear} onClick={...} />`
  — gear icon, **no** `shortcut='Shift+F'` hint. The keybinding still works; only the
  displayed hint is gone.

**i18n was free:** `Settings` already existed in all 33 locales, and `Font & Layout`
survives as the footer tab label in `NavigationBar.tsx`, so the extractor pruned nothing.
Only `More Settings` was new.

**jsdom trap found while testing:** `container.querySelector('[aria-label="Font & Layout"]')`
returns null even when the element exists — jsdom's selector engine fails on the `&` in the
attribute value. A "button is absent" assertion written that way passes forever. Use
`screen.queryByRole('button', { name: ... })`.

Related: [[verify-reader-chrome-needs-e2e]], [[nextjs-app-dir-reserved-route-filenames]].
