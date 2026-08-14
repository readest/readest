# Readest Project Memory

## Key Reference Documents (aggregators)
- [Bug Patterns](bug-patterns.md) · [CSS & Style](css-style-fixes.md) · [TTS](tts-fixes.md)
- [Layout & UI](layout-ui-fixes.md) · [Platform Compat](platform-compat-fixes.md) · [Annotator & Reader](annotator-reader-fixes.md)
- [Sync Fixes](sync-fixes.md) · [Reader Feature Fixes](reader-feature-fixes.md)
- [Paginator & Scroll Fixes](paginator-scroll-fixes.md) · [Build & CI Recipes](build-ci-recipes.md)
## Safety & Security
- [Apple lost storage purchase](apple-iap-lost-storage-purchase-restore-verify.md) buyer CREDITED; restore-verify MERGED #5669, device verify pending
- [0.12.1 App Review crash](appstore-review-crash-0121-aswebauth-anchor.md) UNFIXED; `presentationAnchor` nil-window; reviewer = `xnu_development` in Sentry
- [iOS <=16 fonts.ready WebContent crash](ios16-fonts-ready-webcontent-crash.md) MERGED #5654 + foliate#71; verify pending; poll `fonts.status` on old WebKit
- [Google RTDN verify downgrade](google-rtdn-worker-verify-downgrade-incident.md) googleapis dead on workerd · [Play storage add-ons never consumed](google-iap-consume-storage-purchases.md) MERGED #5545
- [In-place delete wiped originals](in-place-delete-wiped-originals.md) never `fs.removeFile` `external` · [#5084/#5265 "Delete locally" wiped Drive](gdrive-delete-locally-wiped-cloud-5084.md) MERGED #5376
- [#4703 backup zip Win paths](backup-windows-zip-paths-4703.md) · [#4639 download_file scope](download-file-scope-android-regression.md)
- [#5147 Drive "Untitled" root files](gdrive-untitled-root-files-5147.md) · [Security advisories 2026-06](security-advisories-web-2026-06.md)
- [#5118 iOS PDF WebContent OOM](pdf-ios-webcontent-oom-zoom-5118.md) clamp renderDpr; [#5251 blurry desktop](pdf-blurry-desktop-dpr-clamp-5251.md) budget mobile-only
## Paginator & Scroll
- Resolved/stable → [Paginator & Scroll Fixes](paginator-scroll-fixes.md)
- [#5179 layered-turn toolbar sync](pr-5179-layered-turn-toolbar-sync.md) MERGED; review defects UNFIXED
## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` EPUB CSS hub · `packages/foliate-js/paginator.js` · `src/services/tts/TTSController.ts`
- `src/hooks/useSafeAreaInsets.ts` · `src/app/reader/components/FoliateViewer.tsx` · `.../annotator/Annotator.tsx`
## Sync Notes
- Resolved/stable sync memories → [Sync Fixes](sync-fixes.md)
- [#5426 BookOrbit integration](bookorbit-integration-5426.md) MERGED #5487 · [#5062 multi-provider sync](multi-provider-cloud-sync-5062.md) MERGED #5122; native verify pending
- [iCloud sync provider](icloud-sync-provider.md) SHIPPED #5532+#5537; Dev ID recommit due 2027-02; MAS sandbox-blank open
- [#5570 KOSync/BookOrbit custom headers](custom-headers-kosync-bookorbit-5570.md) MERGED; kosync proxy OPEN RELAY fix UNMERGED on `fix/kosync-proxy-endpoint-allowlist`
- [#5661 "Synced in an hour"](sync-clock-skew-lastsynced-5661.md) display clamp MERGED #5674; epoch-skew LWW poisoning itself unfixed (user's clock)
- [#5253 OneDrive OAuth trailing slash](onedrive-oauth-callback-slash-5253.md) MERGED #5479; Rust drops unknown TS fields
- [OneDrive AADSTS90023 Origin](onedrive-token-origin-aadsts90023.md) MERGED #5604, verified; needs `unsafe-headers` + `Origin: ''`
- [deleted_at OR cursor invariant](sync-deleted-at-cursor-invariant.md) load-bearing · [#5465 dictionary prefs vs toggle](dictionary-prefs-settings-replica-category-5465.md) MERGED #5470
- #5067 shelf progress never pulled `mergeBookMetadata` subset = what travels
- [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED; fix = rm readest_library.sqlite3 · [10k library breaks /sync pull](sync-pull-10k-worker-1102.md) MERGED #5364
- [#5625 loadDocument parsererror fallback](loaddocument-xhtml-parsererror-5625.md) MERGED #5630 + foliate#70; device verify pending
## Build, Testing & CI
- [Kindle SSH deploy+debug recipe](kindle-ssh-deploy-debug-recipe.md) 192.168.2.180:2222 blank-pw askpass; crash.log silent for sync (dbg-level); check device WAN first
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md) · [Store listings in fastlane](store-listings-fastlane-5573.md) MERGED #5573; readest-promotions NOT live
- [Turbopack dev stale chunk phantom](turbopack-dev-stale-chunk-phantom.md) rm -rf .next first · [Concurrent sessions share .next/out](concurrent-sessions-share-next-out-dir.md) check `ps` first
- [format:check gate](verify-format-check-gate.md) · [Worktree rebase submodule drift](worktree-rebase-submodule-drift.md) · [Worktree submodule origin = local gitdir](worktree-submodule-origin-is-local-gitdir.md) use FETCH_HEAD
- [worktree:rm deinits the SHARED .git/config](worktree-rm-deinits-shared-git-config.md) check `git submodule status` after rm
- [Shared-target stale plugin cache](worktree-shared-target-stale-plugin-cache.md) cargo clean -p only · [Web e2e local flake](web-e2e-local-devserver-cold-compile-flake.md) cold compile, NOT your change
- [Chrome verify recipe](browser-verify-readest-web-recipe.md) · [CI/PR delivery + push keepalive](ci-pr-delivery-and-push.md) fork pushes need SSH
- [#5550 docker never applied migrations](docker-selfhost-migrations-never-applied-5550.md) MERGED #5551; dir mount shadows core schema
- [PR #5605 nix packaging review](nix-packaging-pr-5605.md) 2 blockers posted; readest ALREADY in nixpkgs — cachix = CI-only
- test-tauri.sh webdriver bogus timeout MERGED #5644: WEBDRIVER_TIMEOUT=900 + build_tauri_app gated on tauri paths
## Platform Compat
- Resolved/stable → pointer index at end of [Platform Compat](platform-compat-fixes.md)
- [#1217 FireOS import no-op](fireos-import-activity-recreation-1217.md) MERGED #5531 · [#5372/#2862 Play keeps All Files Access](play-all-files-access-restored-5372.md) MERGED #5378; NEXT submission fills the form
- [iOS .txt/.md share sheet lost](ios-txt-share-sheet-tauri211-fileassoc.md) MERGED #5415 · [#5397 Photos save crash](ios-photos-add-usage-description-5397.md) MERGED #5405; device-verify pending
- [Android OAuth hangs on MS passkey page](android-oauth-passkey-no-credential-provider.md) no Credential Manager provider; wedges WebAuthn till reboot; NOT a CCT bug
- [APKs opened with Readest](android-intent-filter-pathpattern-needs-host.md) MERGED #5610, verify PENDING; `pathPattern` DEAD without `android:host`
## Reader Features & UI
- Resolved/stable feature memories → [Reader Feature Fixes](reader-feature-fixes.md)
- [#5662 Alert sized off its own text](alert-flex-item-content-sizing-5662.md) MERGED; `w-full` wrapper LOAD-BEARING; needs browser test
- [#5660 Home/End jump to book start/end](home-end-book-jump-5660.md) MERGED #5673 (`1cbab73f9`); `goToFraction(0|1)` covers reflowable+FXL+scrolled in ONE call; view is in the store BEFORE `view.init()` so guard on `inited`; footer "66 / 68" at the true end is correct (location = page START fraction)
- [Azure translator edge auth retired](azure-translator-edge-auth-retired.md) MERGED #5555; short lang codes #5620 verified
- [#1582 translated text loses formatting](translation-inline-markup-1582.md) STILL OPEN; default `deepl` CORRUPTS markup
- [#5600 PDF quota toast on every selection](pdf-translation-quota-toast-5600.md) MERGED #5617; contextmenu auto-open + stale `translationEnabled` UNFIXED
- [RSVP landscape safe-area insets](rsvp-landscape-safe-area-insets-5548.md) MERGED; the ONE physical pl/pr exception · [#3392 footer page-number jump](page-number-jump-3392.md) MERGED #5524
- [#5538 highlight resize orphan bubble](highlight-resize-orphan-note-bubble-5538.md) MERGED #5541; drag-race overlay UNFIXED · [#5539 TTS ruby furigana](tts-ruby-furigana-readings-5539.md) MERGED #5546
- [#4977 top bar blocks text selection](header-trigger-overlaps-text-4977.md) strip sized to content top; iPad web gap
- [#5561 BT Play dead after a pause](tts-paused-webview-freeze-5561.md) MERGED #5567 · [TTS listening counts as reading stats](tts-listening-counts-as-reading-stats.md) MERGED #5450
- [#5480 Media Overlays narration](media-overlay-narration-5480.md) MERGED; 3 review findings UNFIXED
- [#5562 MO narration via iOS native AVPlayer](media-overlay-ios-native-playout-5562.md) MERGED; Swift compiled ONLY by ios build; verify PENDING
- [#1359 pull-down bookmark gesture](pull-down-bookmark-gesture-1359.md) MERGED #5493 · [#5501 Apple Pencil page turner](apple-pencil-page-turner-5501.md) MERGED #5511; verify PENDING
- [Mobile sheet virtuoso first-paint blank](mobile-sheet-virtuoso-first-paint-blank.md) PRE-EXISTING · [PR #5389 library full-text search review](pr-5389-library-search-review.md) plan in .agents/plans
- [Readest Voice self-hosted TTS](selfhosted-premium-tts-plans.md) APPROVED 2026-07-08; not started
- [#4584 tap-death](issue-4584-tap-death-investigation.md) UNFIXED; likely WebView-148 · [#5353 italic last glyph clipped](italic-synthetic-oblique-clip-5353.md) WebView regression, not Readest code
- [#5250 invert img dead w/ overrideColor](invert-img-dark-override-5250.md) PR #5383 open, VERIFIED
- [#5633 iOS image zoom blurry](ios-imageviewer-zoom-blur-5633.md) MERGED #5639; TableViewer same bug UNFIXED; verify pending
- [#5635 Auto Scroll progress frozen](autoscroll-progress-relocate-maxwait-5635.md) MERGED #5676 + foliate#72; scrolled relocate 1s max-wait; jitter (item 1) OPEN
- [#5647 footnote jump flash](footnote-jump-flash-5647.md) MERGED #5655; searchHighlight.ts RENAMED transientHighlight.ts
- [#5649 FXL text follows the theme](fxl-authored-colors-5649.md) MERGED #5657; FXL docs get ONLY applyFixedlayoutStyles
- [#5641 Chrome-Android FXL text autosizing](fxl-chrome-android-text-autosizing-5641.md) MERGED #5659; verify pending; fix = text-size-adjust none
- [#5663 last page unreachable on iOS 18](ios-last-page-scroll-clamp-5663.md) PR #5678 + foliate#73 OPEN; cssAnimateScroll transforms shrink the container scroll extent, WebKit clamps the final scrollLeft one page short; forced layout does NOT fix it, rAF re-apply does; repros iOS 18.5 NOT 26.3; headless self-driving sim harness
- [#5414 Edge silence untrimmed on iOS](edge-tts-baked-silence-ios-native-5414.md) MERGED #5417; verify pending · [#5230 Edge TTS mid-book stall](edge-tts-tauri-ws-hang-5230.md) MERGED #5534
- [Proofread gate = reflowable formats](proofread-gate-reflowable-formats.md) selection rules born dead (UNFIXED)
- [Override Layout collapsed `<pre>`](override-layout-collapses-pre-whitespace.md) MERGED #5549 · [Stale format gates in Settings](stale-format-gates-in-settings.md)
- [Scroll toggle broke turn animation](captured-turn-prepared-surface-lost-on-scroll-toggle.md) FIXED+verified; CDP touch hold is the instrument
- Proofread: [#4700](proofread-enhancements-4700.md); [#4781 CRDT](proofread-per-book-crdt-sync.md); #4859 edit toggle; [#5277 fonts lost](proofread-rule-change-font-loss-5277.md) MERGED #5345
- [Send-to-Readest local file:// clips](send-to-readest-local-file-clips.md) metaHash dedup · [Extension file:// fetch capability](extension-file-url-fetch-capability.md) content scripts CANNOT
- [OPDS fixes](opds-fixes.md) #4479 #4502 #4503 #4749 #4782 #4272 Basic-400s TLS#4988 Calibre-authors#5183 http-selflinks#5300 searchTerms#5500
- [#5583 download format filter](opds-download-format-filter-5583.md) PR #5593
- koplugin: [#4374 cover upload](koplugin-cover-upload.md); #5094 gesture + upload current; [#4954 slow open](koplugin-library-open-mosaic-cache-4954.md)
- [#5666 Push stats now wedged](koplugin-stats-push-chunking-5666.md) MERGED #5670; 500-event chunks w/ per-chunk cursor
- [#5645 self-update crash on KOReader 2026.07+](koplugin-selfupdate-unpackarchive-5645.md) PR #5656; Device:unpackArchive DROPPED upstream
- [#5507 auth nil response](koplugin-auth-nil-response-5507.md) MERGED; busted = ONE state · [#5527 conflict re-prompt on refocus](kosync-conflict-reprompt-5527.md) MERGED #5528
- Calibre: [plugin push #4863](calibre-plugin-push-4863.md); `uploaded_at` != blob #5325; status marks #5332; [custom columns #4811](calibre-custom-columns-4811.md)
## Library Fixes
- [Web novel import](webnovel-url-import-5294.md) MERGED #5381 · [#5650 CDN 52x retry + metadata backfill](novel-import-transient-fetch-metadata-5650.md) MERGED; chapter TRUNCATION still UNFIXED
- [#5596 long-press select double-toggles](longpress-contextmenu-double-fire-5596.md) MERGED #5621, verify pending
- [Book action platform surfaces](book-actions-platform-surfaces.md) · [menu append race #4389](tauri-menu-append-race-4389.md) · [iOS cover picker no-op](ios-cover-picker-nofilter-5346.md) MERGED #5346
- TXT: [#4390 author](txt-author-recognition-4390.md); [#4658 chapter measure-word](txt-chapter-measure-word-4658.md)
- [Cover stale (in-place mutation)](cover-stale-inplace-mutation-memo.md) · [Series/author back no-op #4437](series-folder-back-noop-4437.md)
- [Library/reader texture #4743](library-reader-separate-texture-4743.md) · [list series overflow #4796](list-view-series-overflow-4796.md)
- [#3797 recently-read shelf](recent-read-shelf-3797.md) · #3889 auto-import folders · [auto-import re-imports dupes](auto-import-duplicate-files-reimport.md) MERGED #5337; needs `altFilePaths`
- [#5601 bulk folder import exhaustion](bulk-folder-import-exhaustion-5601.md) #5607+#5615 MERGED, verified; Android `allow_paths_in_scopes` silent no-op UNFIXED
- [#5658 OPDS books erased on restart](opds-autodownload-tombstone-5658.md) MERGED #5665; knownEntryIds device-local, tombstones sync
- [#5411 PDF metaHash filename salt](pdf-metahash-filename-salt-5411.md) MERGED #5412; re-parse preserves salt · [koplugin metaHash parity](koplugin-metahash-parity.md) MERGED #5508
- #5079 Time Remaining sort "no time" bucket OUTSIDE sort multiplier · memo comparator swallows new prop
- [#5175 select bar hides last book](select-mode-actions-overlap-last-book-5175.md) Virtuoso Footer spacer · [#5222 bookshelf import menu](bookshelf-import-menu-popup-5247.md) MERGED #5247
- [#5360 Wayland tap kills native menu](wayland-tap-context-menu-5360.md) MERGED #5467; verify pending
## Networking & LAN
- [LocalSend integration](localsend-integration.md) MERGED #5611; fork `readest/localsend`; mTLS needs `WebConfig{upload:true}`; commands need 3-place ACL
- [koplugin LocalSend receive+send](koplugin-localsend-receive.md) MERGED #5687 (15b446dc7); REARCHITECTED cdylib→static-musl BINARY+subprocess (Kindle glibc crash); crate renamed localsend-ffi→localsend-bin; SEND added; Kindle→Xiaomi device-VERIFIED; register_peer fix = iOS/Android discovery; fork pinned 3cae1825 (SO_REUSEPORT best-effort); i18n done all 33 locales; ANDROID exec still IMPOSSIBLE
- LocalSend discovery was DEAD 3 ways — MERGED #5626 + fork rev 37219949; rev bumps rebase BOTH patches
- [#5651 RLM->ZWNJ half-space](persian-rlm-halfspace-zwnj-5651.md) MERGED; U+0600-06FF contains DIGITS — swap between digits flips visual order
## Architecture & Patterns
- [CFI.compare null = app crash](cfi-compare-null-crash-findnearestcfi.md) MERGED #5533; `''` cfi is SAFE · [Minified `Module.<letter>` frames](minified-stack-module-namespace-frames.md) = `import * as` namespace
- [Native DB close() closes ALL turso conns](native-db-close-all-not-loaded.md) MERGED #5497; "not loaded" = READEST-6 · [Turso "concurrent use forbidden"](turso-concurrent-use-forbidden.md) `op_lock` async mutex
- foliate-js submodule `packages/foliate-js/`; multiview paginator preloads adjacent sections
- [#5097/#5308 encoded href](epub-encoded-href-reserved-chars-5097.md) `decodeURI` keeps reserved chars; MERGED #5311
- [#5273 undeclared cover.jpg](epub-undeclared-cover-entry-5273.md) MERGED #5339 + foliate#61 · [#5455 OPF `<item></item>` skipped](epub-opf-expanded-item-tags-5455.md) MERGED #5463
- Markdown: [.md support #774](markdown-md-support-774.md); resume position #4862; footnotes #5074; [#5279 YAML frontmatter](markdown-yaml-frontmatter-5279.md) MERGED #5344; dedup race UNFIXED
- [md titled after first H1, not the file](markdown-title-first-h1-over-filename.md) PR #5653; existing libraries keep their titles
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding; `transformStylesheet()` rewrites EPUB CSS
- TTS `#ttsSectionIndex`; insets: native plugin → useSafeAreaInsets → styles; Dropdowns `DropdownContext`
- Stale settings closure: persist `useSettingsStore.getState().settings` ([#4780](webdav-connect-nullified-4780.md)) · Page margins not live #4898 in-place mutation froze memo
- [#5301 "Column Gap"->"Additional Margin"](column-gap-additional-margins-5301.md) label rename only
- [Foliate touch-listener capture phase](foliate-touch-listener-capture-phase.md) · [iframe cross-realm instanceof](iframe-cross-realm-instanceof.md) duck-type `'closest'`
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) · [Theorem competitor analysis](theorem-competitor-feature-analysis.md)
- [Design system → DESIGN.md](feedback_design_system_doc.md) never `pl/pr/ml/mr` (RTL)
## Workflow & Feedback
- [Slice-in-loop NOT O(n^2)](review-perf-slice-not-quadratic.md) V8 SlicedString · [Commit messages English-only](feedback-commit-message-english-only.md) no CJK, no em/en dashes
- PR flow: [rebase onto origin/main](feedback_pr_rebase.md); [fresh branch per PR](feedback_pr_new_branch.md); [always `pnpm worktree:new`](feedback_use_worktree.md); [don't push till confirmed](feedback_dont_push_every_change.md)
- [Test file filter](feedback_test_file_filter.md) `pnpm test <path>` no `--` · [No test seams in prod](feedback_no_test_seams_in_prod.md) · [no lookbehind regex](feedback_no_lookbehind_regex.md)
- [No mock-only platform tests](feedback-no-mock-only-platform-tests.md) skip call-sequence tests over mocked IPC · [No config-mirror tests](feedback-no-config-mirror-tests.md) validate via `cargo check`
- i18n: [en plurals manual](feedback_en_plurals_manual.md); [i18n:extract prunes keys](i18n-extract-prunes-keys.md); {{provider}} case suffixes #5102; [label rename = key rename](i18n-label-rename-workflow.md)
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) `overrides:` · [deps security recipe](deps-security-overrides-workflow.md) MERGED #5335+#5518 · [gstack upgrade](feedback_gstack_upgrade.md)
- [Next page-export check webpack-only](nextjs-page-export-webpack-only-check.md) MERGED #5336; `rm -rf .next` if lint trips
