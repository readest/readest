---
name: push-turn-touch-takeover-7635
description: "#7635 (MERGED 4dddf6443) / foliate #180 (MERGED fd05acd) rapid push swipes: narrowed to the touch takeover; pin 050e55b on perf/push-turn-on-pin; device check without touching the owner's book settings"
metadata:
  node_type: memory
  type: project
  originSessionId: ddf0b0d2-7c1b-4756-9ffd-3d7202253d72
  modified: 2026-11-18T15:20:19.041Z
---

leehuazhong's #7635 + readest/foliate-js#180 (2026-11-18) bundled ~10 paginator changes. On review the owner said "fix the issues and update pr", so I narrowed both to the touch takeover of an in-flight horizontal push turn. That means `startCssAnimateScroll`/`startRafAnimateScroll` handles, `snap` judged from the interrupted target, `#currentPage`, and goTo/destroy abort. I pushed to the contributor branches; after three more CodeRabbit rounds the readest head `61e713208` MERGED 2026-11-18 as `4dddf6443`, and foliate #180 MERGED 2026-11-18 as `fd05acd` on foliate main (same patch). The pin is `a38923e` on readest/foliate-js `perf/push-turn-on-pin` (was `050e55b`) (5d096be + cb75d44 + narrowing f5efdce, with main's newer pin 6abeeae from #7642 merged in; readest head 2e5a6e9c6).

- Left out on purpose, each needing its own PR with device numbers: the GPU threshold (20000 px stays; Android stalled ~1 s on bigger layers, c1c7315), leading-view trim + idle trim, background node reuse, synchronous snap outside Firefox, turn retry after preload, ResizeObserver skip.
- Old-pin symptom (dev-web): two swipes ~90 ms apart turn 1 page and the on-screen offset jumps back (5036→4752→4610) before snapping.
- nix_flake_check failed only because the pin lived on the contributor's fork. Once the commit is on any readest/foliate-js branch it passes, as with the other `-on-pin` pins.

**How to apply (device recipe):** to test paginated push on the Xiaomi without changing the owner's per-book settings, set `renderer.setAttribute('flow','paginated')` and `removeAttribute('turn-style')` via CDP. Save `view.lastLocation.cfi` first, then restore both attributes and `view.goTo(cfi)`. Build the CDP ws URL as `ws://127.0.0.1:9223/devtools/page/<id>`; with the `Host: localhost` header, `/json` returns URLs without the port. Driver: `Input.dispatchTouchEvent` swipes plus a page-side rAF recorder of `containerPosition - transform.m41`. Don't switch the worktree's foliate submodule branch while `pnpm dev-android` builds: the build type-checks whatever is checked out. See [[feedback-always-verify-on-xiaomi]], [[cfi-range-start-between-children-7482]].
