# Readest Project Memory

## Key Reference Documents (aggregators)
- [Bug Patterns](bug-patterns.md) · [CSS & Style](css-style-fixes.md) · [TTS](tts-fixes.md)
- [Layout & UI](layout-ui-fixes.md) · [Platform Compat](platform-compat-fixes.md) · [Annotator & Reader](annotator-reader-fixes.md)
- [Sync Fixes](sync-fixes.md) · [Reader Feature Fixes](reader-feature-fixes.md)
- [Paginator & Scroll Fixes](paginator-scroll-fixes.md) · [Build & CI Recipes](build-ci-recipes.md)
## Safety & Security
- [Google RTDN verify downgrade](google-rtdn-worker-verify-downgrade-incident.md) googleapis dead on workerd
- [In-place delete wiped originals](in-place-delete-wiped-originals.md) never `fs.removeFile` `external`
- [#5084/#5265 "Delete locally" wiped Drive](gdrive-delete-locally-wiped-cloud-5084.md) MERGED #5376
- [#4703 backup zip Win paths](backup-windows-zip-paths-4703.md) · [#4639 download_file scope](download-file-scope-android-regression.md)
- [#5147 Drive "Untitled" root files](gdrive-untitled-root-files-5147.md) atomic multipart create
- [Security advisories 2026-06](security-advisories-web-2026-06.md)
- [#5118 iOS PDF WebContent OOM](pdf-ios-webcontent-oom-zoom-5118.md) clamp renderDpr; [#5251 blurry on desktop](pdf-blurry-desktop-dpr-clamp-5251.md) budget mobile-only
## Paginator & Scroll
- Resolved/stable → [Paginator & Scroll Fixes](paginator-scroll-fixes.md)
- [#5179 layered-turn toolbar sync](pr-5179-layered-turn-toolbar-sync.md) MERGED; review defects UNFIXED
## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` EPUB CSS hub · `packages/foliate-js/paginator.js` · `src/services/tts/TTSController.ts`
- `src/hooks/useSafeAreaInsets.ts` · `src/app/reader/components/FoliateViewer.tsx` · `.../annotator/Annotator.tsx`
## Sync Notes
- Resolved/stable sync memories → [Sync Fixes](sync-fixes.md)
- [#5426 BookOrbit integration](bookorbit-integration-5426.md) MERGED #5487; live-server smoke pending
- [iCloud sync provider](icloud-sync-provider.md) SHIPPED #5532+#5537 all channels; smoke-verified macOS+iOS; Dev ID profile recommit due 2027-02; MAS sandbox-blank open
- [#5062 multi-provider cloud sync](multi-provider-cloud-sync-5062.md) MERGED #5122; native verify pending
- [#5253 OneDrive OAuth trailing slash](onedrive-oauth-callback-slash-5253.md) MERGED #5479; Rust AuthRequest drops unknown TS fields; device verify pending
- [deleted_at OR cursor invariant](sync-deleted-at-cursor-invariant.md) notes/configs OR load-bearing
- [#5465 dictionary prefs vs Dictionaries toggle](dictionary-prefs-settings-replica-category-5465.md) MERGED #5470; category gates by replica KIND
- #5067 shelf progress never pulled `mergeBookMetadata` subset = what travels
- [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED; fix = rm readest_library.sqlite3
- [10k library breaks /sync pull](sync-pull-10k-worker-1102.md) MERGED #5364; old clients wedge till app update
## Build, Testing & CI
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md)
- [Turbopack dev stale chunk phantom](turbopack-dev-stale-chunk-phantom.md) rm -rf .next before EVERY dev start; reload/restart do NOT help
- [format:check gate](verify-format-check-gate.md) · [Worktree rebase submodule drift](worktree-rebase-submodule-drift.md)
- [Shared-target stale plugin cache](worktree-shared-target-stale-plugin-cache.md) deleted worktree poisons tauri-build in ALL worktrees; cargo clean -p, never full clean
- [Web e2e local flake](web-e2e-local-devserver-cold-compile-flake.md) cold compile, NOT your change; warm dev-web first
- [Chrome verify recipe for reader fixes](browser-verify-readest-web-recipe.md) config in IndexedDB `AppFileSystem`; synthetic PointerEvents for handle drags; count overlayer `<g>`s
- [CI/PR delivery + push keepalive](ci-pr-delivery-and-push.md) fork pushes need SSH
## Platform Compat
- Resolved/stable → pointer index at end of [Platform Compat](platform-compat-fixes.md)
- [#1217 FireOS import no-op](fireos-import-activity-recreation-1217.md) MERGED #5531; native-bridge picker + file-picker-result replay; Xiaomi-13-verified via am-kill-behind-picker ("Don't keep activities" DEAD on Xiaomi); FireOS-hardware verify pending — ask reporters to retest on next release
- [#5372/#2862 Play keeps All Files Access](play-all-files-access-restored-5372.md) MERGED #5378; NEXT Play submission must fill the form
- [0.11.20 iOS .txt/.md share sheet lost](ios-txt-share-sheet-tauri211-fileassoc.md) MERGED #5415; device-verify pending
- [#5397 Photos save crash](ios-photos-add-usage-description-5397.md) MERGED #5405, device-verify pending
## Reader Features & UI
- [#3392 footer page-number jump](page-number-jump-3392.md) MERGED #5524; type-over "94 / 251" label + sizer span; e2e readingProgress reads the input; never i18n:extract mid-rebase; device IME check pending
- [#5516 Pages in Book Details](book-details-page-count-5516.md) MERGED #5523; `book.progress[1]` = foliate `ceil(spine bytes/1500)` locations, NOT laid-out pages; reader `bookData.book` = stale open-time snapshot, live count is in `bookData.config`
- [#5499 Android autofill sign-in + login rework](android-signin-autofill-formdata-5499.md) MERGED #5505; FormData at submit; IME Next resets viewport pan; auth-ui only on /auth/recovery now
- [#5538 highlight resize orphan note bubble](highlight-resize-orphan-note-bubble-5538.md) MERGED #5541; record never duplicated, the note-bubble OVERLAY was; both overlays keyed by cfi; drag-race stale highlight overlay UNFIXED
- [#5496 popup chrome family](popup-chrome-family-5496.md) MERGED; `.popup-container` class load-bearing for eink, nested cards add NO border, Popup caps height but never clips
- [#5213 dictionary quick action single-word gate](quick-action-dictionary-single-word-5213.md) MERGED #5529; isSingleLookupTerm 8-char CJK cap; Chrome-verified
- [#4977 top bar blocks text selection](header-trigger-overlaps-text-4977.md) strip sized to content top; iPad web gap
- [TTS listening counts as reading stats](tts-listening-counts-as-reading-stats.md) MERGED #5450; device verify PENDING
- [#5480 Media Overlays narration](media-overlay-narration-5480.md) MERGED; 3 review findings UNFIXED
- [#1359 pull-down bookmark gesture](pull-down-bookmark-gesture-1359.md) MERGED #5493; ribbon moved top-right; preview fill = post-release state; wrapper transform isolates texture blend = luminance jump, fixed with wrapper bg-base-100; pull dismisses visible toolbars; Xiaomi-verified
- [#5501 Apple Pencil page turner](apple-pencil-page-turner-5501.md) MERGED #5511; preferred*Action are CLASS props; pencil keys skip media interception; Simulator can't emulate pencil; device verify PENDING
- Resolved/stable feature memories → [Reader Feature Fixes](reader-feature-fixes.md)
- [Mobile sheet virtuoso first-paint blank](mobile-sheet-virtuoso-first-paint-blank.md) PRE-EXISTING, no issue filed
- [PR #5389 library full-text search review](pr-5389-library-search-review.md) plan in .agents/plans
- [Readest Voice self-hosted TTS](selfhosted-premium-tts-plans.md) APPROVED 2026-07-08; not started
- [#4584 tap-death](issue-4584-tap-death-investigation.md) UNFIXED; likely WebView-148
- [#5353 italic last glyph clipped](italic-synthetic-oblique-clip-5353.md) WebView >=~148 regression, not Readest code
- [#5250 invert img dead w/ overrideColor](invert-img-dark-override-5250.md) PR #5383 open, VERIFIED on Xiaomi 13
- [#5414 Edge silence untrimmed on iOS](edge-tts-baked-silence-ios-native-5414.md) MERGED #5417, device-verify pending
- [#5230 Edge TTS mid-book stall](edge-tts-tauri-ws-hang-5230.md) MERGED #5534; Tauri WS never settled on Close/error/silence; static inflight poisoned sentence; Xiaomi-verified incl offline fault injection; ask reporters to retest on release
- Proofread: [#4700](proofread-enhancements-4700.md); [#4781 CRDT](proofread-per-book-crdt-sync.md); #4859 edit toggle; [#5277 fonts lost](proofread-rule-change-font-loss-5277.md) MERGED #5345
- [Send-to-Readest local file:// clips](send-to-readest-local-file-clips.md) clip determinism is a requirement; re-clip dedups via metaHash, never duplicates
- [Extension file:// fetch capability](extension-file-url-fetch-capability.md) SW + extension pages CAN read local files; content scripts and canvas CANNOT
- [OPDS fixes](opds-fixes.md) #4479 #4502 #4503 #4749 #4782 #4272 Basic-400s TLS#4988 Calibre-authors#5183 http-selflinks#5300 encoded-searchTerms#5500
- koplugin: [#4374 cover upload](koplugin-cover-upload.md); #5094 gesture + upload current; [#4954 slow open](koplugin-library-open-mosaic-cache-4954.md)
- [#5507 auth nil response](koplugin-auth-nil-response-5507.md) MERGED; Lua `("err").body` = nil not an error; busted = ONE state so patch require'd tables, never assume which preload won; upvalue-captured `T` must be set BEFORE require
- [#5527 conflict re-prompt on refocus](kosync-conflict-reprompt-5527.md) MERGED #5528; resolved-report memory + same-device % compare; #5065 rule = other devices only; Android device verify pending
- Calibre: [plugin push #4863](calibre-plugin-push-4863.md); `uploaded_at` != blob #5325; status marks #5332; [custom columns #4811](calibre-custom-columns-4811.md)
## Library Fixes
- [Search history chips over textures](library-search-history-mask-fade-5488.md) MERGED #5488; edge fades = `mask-image`, never painted overlays
- [#5119 Then-by asc/desc](library-then-by-sort-order-5119.md) MERGED #5474; settings migration; URL cleanup lies on deep links
- [Book action platform surfaces](book-actions-platform-surfaces.md) · [menu append race #4389](tauri-menu-append-race-4389.md)
- [iOS cover picker no-op](ios-cover-picker-nofilter-5346.md) MERGED #5346
- TXT: [#4390 author](txt-author-recognition-4390.md); [#4658 chapter measure-word](txt-chapter-measure-word-4658.md)
- [Cover stale (in-place mutation)](cover-stale-inplace-mutation-memo.md) · [Series/author back no-op #4437](series-folder-back-noop-4437.md)
- [Library/reader texture #4743](library-reader-separate-texture-4743.md) · [list series overflow #4796](list-view-series-overflow-4796.md)
- [#3797 recently-read shelf](recent-read-shelf-3797.md) · #3889 auto-import folders
- [auto-import re-imports dupes](auto-import-duplicate-files-reimport.md) MERGED #5337; needs `altFilePaths`
- [#5411 PDF metaHash filename salt](pdf-metahash-filename-salt-5411.md) MERGED #5412; re-parse sites must preserve salt
- [koplugin metaHash parity](koplugin-metahash-parity.md) MERGED #5508; getMetadataHash must match book.ts <-> readest_syncconfig.lua; shared hash_source fixtures; store row > cache > compute
- #5079 Time Remaining sort "no time" bucket OUTSIDE sort multiplier
- memo comparator swallows new prop
- [#5175 select bar hides last book](select-mode-actions-overlap-last-book-5175.md) bar height into Virtuoso Footer spacer
- [#5222 bookshelf import menu](bookshelf-import-menu-popup-5247.md) MERGED #5247; Virtuoso clips dropdown-content
- [#5360 Wayland tap kills native menu](wayland-tap-context-menu-5360.md) MERGED #5467; Linux = in-app menu; device verify pending
## Architecture & Patterns
- [CFI.compare null = whole-app crash](cfi-compare-null-crash-findnearestcfi.md) MERGED #5533 discard in bookDataStore; `''` cfi is SAFE so cloud sync is NOT the source (file sync/backup/foliate import are); error.tsx reports to PostHog NOT Sentry; koplugin round-trip NULLs good cfis (unfixed)
- [Minified `Module.<letter>` frames](minified-stack-module-namespace-frames.md) = `import * as` namespace; in Readest that means epubcfi; null vs undefined in message = sync data vs missing key
- [Native DB close() closes ALL turso connections](native-db-close-all-not-loaded.md) MERGED #5497; "not loaded" = READEST-6
- foliate-js submodule `packages/foliate-js/`; multiview paginator preloads adjacent sections
- [#5097/#5308 encoded href](epub-encoded-href-reserved-chars-5097.md) `decodeURI` keeps reserved chars; MERGED #5311
- [#5273 undeclared cover.jpg](epub-undeclared-cover-entry-5273.md) MERGED #5339 + foliate#61; cover resolution duplicated foliate + Rust
- [#5455 OPF `<item></item>` skipped](epub-opf-expanded-item-tags-5455.md) MERGED #5463; #5339 fallback masks it on dev builds
- [Turso "concurrent use forbidden"](turso-concurrent-use-forbidden.md) `op_lock` async mutex
- Markdown: [.md support #774](markdown-md-support-774.md); resume position #4862; footnotes #5074
- [#5279 md YAML frontmatter](markdown-yaml-frontmatter-5279.md) MERGED #5344; dedup race UNFIXED
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding; `transformStylesheet()` rewrites EPUB CSS
- TTS `#ttsSectionIndex`; insets: native plugin → useSafeAreaInsets → styles; Dropdowns `DropdownContext`
- [#5259 dropdown viewport fix](dropdown-floating-ui-portal-5259.md) MERGED #5392; portals break TalkBack/VoiceOver traversal
- Stale settings closure: persist `useSettingsStore.getState().settings` ([#4780](webdav-connect-nullified-4780.md))
- Page margins not live #4898 in-place mutation froze memo
- [#5301 "Column Gap"->"Additional Margin"](column-gap-additional-margins-5301.md) label rename only
- [Foliate touch-listener capture phase](foliate-touch-listener-capture-phase.md) · [iframe cross-realm instanceof](iframe-cross-realm-instanceof.md) duck-type `'closest'`
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md)
- [Design system → DESIGN.md](feedback_design_system_doc.md) never `pl/pr/ml/mr` (RTL)
- [Theorem competitor analysis](theorem-competitor-feature-analysis.md)
## Workflow & Feedback
- [Slice-in-loop NOT O(n^2)](review-perf-slice-not-quadratic.md) V8 SlicedString
- [Commit messages English-only](feedback-commit-message-english-only.md) no CJK, no em/en dashes
- PR flow: [rebase onto origin/main](feedback_pr_rebase.md); [fresh branch per PR](feedback_pr_new_branch.md); [always `pnpm worktree:new`](feedback_use_worktree.md); [don't push till confirmed](feedback_dont_push_every_change.md)
- [Test file filter](feedback_test_file_filter.md) `pnpm test <path>` no `--`
- [No mock-only platform tests](feedback-no-mock-only-platform-tests.md) skip call-sequence tests over mocked IPC
- [No test seams in prod](feedback_no_test_seams_in_prod.md) · [no lookbehind regex](feedback_no_lookbehind_regex.md)
- i18n: [en plurals manual](feedback_en_plurals_manual.md); [i18n:extract prunes keys](i18n-extract-prunes-keys.md); {{provider}} case suffixes #5102
- [Label rename = key rename](i18n-label-rename-workflow.md) strip the changed word from each locale's OLD value; mirror `commandRegistry.ts`
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) `overrides:` · [deps security recipe](deps-security-overrides-workflow.md) MERGED #5335 + #5518 · [gstack upgrade](feedback_gstack_upgrade.md)
- [Next page-export check webpack-only](nextjs-page-export-webpack-only-check.md) MERGED #5336; `rm -rf .next` if lint trips
