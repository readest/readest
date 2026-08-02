---
name: reader-toolbar-touch-targets-5401
description: "#5401 Boox Tab Mini C reader toolbar untappable - controls had 32x32 hit boxes vs DESIGN.md's 44px; overflow-x-auto clips touch-target halos vertically; window-button -8px tiles exactly so only :only-child may grow"
metadata:
  type: project
---

#5401 "Nav Bar Touch Issues on Boox Tab Mini C" (7.8" color e-ink Android
tablet): the reader's top bar was "nearly impossible to tap ... especially the
close button", and tapping the X turned the page. MERGED as #5437 (`8e009cd61`).

**Root cause (measured, not inferred).** The bar is `h-11` (44px) but its
controls claimed far less. Measured on-device at Boox geometry:

| control | icon | hit box |
| --- | --- | --- |
| Sidebar / Library / Bookmark / Translation / Font & Layout / Notebook | 32x32 | **32x32** |
| Quick Action, View Options (already `touch-target`) | 32x32 | 54x54 |
| **Close Book** (`.window-button`) | 24x24 | **40x40** |

Only 2 of 9 met the 44px mobile minimum DESIGN.md:728-730 already mandates.

**"Tapping X turns the page" is really TWO taps.** A tap below the bar lands in
the iframe -> `iframe-single-click` -> `usePagination` sees `hoveredBookKey` set
and only DISMISSES the toolbar (verified: `renderer.start` unchanged at 8424).
The *next* tap turns the page (8424 -> 9126). On e-ink the refresh lag hides the
dismissal, so a near-miss reads as "button did nothing, then it turned the page".
Do not go hunting for an unguarded page-turn path; there isn't one.

**Fix (3 parts, all needed):**
1. `components/Button.tsx` - add `touch-target`. Only 8 call sites, all reader
   chrome (header togglers + footer bar), so one edit covers both bars.
2. `HeaderBar.tsx` - `h-full` on the start-tools scroller. **`overflow-x-auto`
   clips VERTICALLY too** (per spec `visible` computes to `auto` on the other
   axis), and shrink-wrapped to the 32px icons it cut those halos straight back
   to 32px. This is the trap: adding `touch-target` alone did nothing for the
   four buttons inside that wrapper.
3. `globals.css` - `.window-button:only-child::before { inset: -10px }` (= 44x44).
   **Must be `:only-child`**: the desktop trio (minimize/maximize/close) sits
   `space-x-2` = 8px apart, and 24 + 8 + 8 means `-8px` is the widest halo that
   tiles EXACTLY. Any blanket bump makes each button swallow its neighbor's
   right edge (later-in-DOM wins the overlap). Mobile renders close alone
   (`hasWindowBar` false), hence no neighbor, hence free to grow.

**Repro recipe - emulate a Boox on any Android device:**
`adb shell wm size 1404x1872 && adb shell wm density 320` -> 702x936 CSS px at
dpr 2, exactly the Tab Mini C. 702 >= 640 so it takes HeaderBar's large-screen
branch (`absolute` not `fixed z-20`, `gridInsets` not `screenInsets`,
`hidden sm:flex` items shown). **ALWAYS `wm size reset && wm density reset`
IMMEDIATELY after measuring** - chrox noticed the distorted screen and called it
out. Reset in the same pass as the measurement, never "at the end of the task".

**Measuring a true hit box via CDP:** walk `document.elementFromPoint` outward
from the control's center until it stops resolving to that control. Catches
pseudo-element halos, overlapping neighbors and clipping ancestors the way a
finger does - `getBoundingClientRect` sees none of that.

**Lane gotchas hit here:**
- CDP `/json/list` returns `webSocketDebuggerUrl` as `ws://localhost/...` with
  NO port; rewrite the host to `127.0.0.1:<forwarded port>` or the connect fails.
- Live DOM mutations injected to prototype a fix SURVIVE re-opening the book, so
  a later test run passes on an unfixed build. Force-stop before believing it
  (same trap as [[header-trigger-band-first-line-5429]]).
- The phone screen locks during a ~30 min gradle build; the test then taps the
  lock screen and fails with "timed out waiting for header bar shown", which
  looks like a measurement failure but isn't. Nothing in adb can pass a PIN.

**OUTSTANDING:** the fix was never run against the *compiled* build - merged on
the strength of (a) the new e2e failing on the released build with exactly the
sizes above and (b) a live-DOM injection of the same 3 changes measuring 44x44.
Worth one `pnpm test:android src/__tests__/android/header-touch-targets.android.test.ts`
on an unlocked device.

**Noticed, not fixed:** the header animates `margin-top` 300ms when the status
bar appears with it (`Reader.tsx` `systemUIVisible = !!hoveredBookKey || ...`),
so on slow e-ink the bar slides out from under a finger. Possible follow-up.

Related: [[header-trigger-band-first-line-5429]], [[android-cdp-e2e-lane]],
[[feedback-no-mock-only-platform-tests]], [[feedback_design_system_doc]]
