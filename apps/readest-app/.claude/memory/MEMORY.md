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
- [Books toggle doesn't gate OPDS uploads](sync-books-toggle-opds-upload-leak.md) OPDS gate MERGED #5759; `isBookUploadAllowed` provider-only + queued residue UNFIXED; syncCategories NOT in SETTINGS_WHITELIST
- [#5062 multi-provider sync](multi-provider-cloud-sync-5062.md) MERGED #5122; native verify pending
- [iCloud sync provider](icloud-sync-provider.md) SHIPPED #5532+#5537; Dev ID recommit due 2027-02
- [MAS blank window](mas-sandbox-blank-customrootdir.md) hardening MERGED #5789; stale `customRootDir` sandbox-denied; runtime verify PENDING; macOS custom root has NO security-scoped bookmark; readest has NO VERSION file (`/ship` bump N/A)
- [#5570 KOSync/BookOrbit custom headers](custom-headers-kosync-bookorbit-5570.md) MERGED; kosync proxy OPEN RELAY fix UNMERGED on `fix/kosync-proxy-endpoint-allowlist`
- [#5661 "Synced in an hour"](sync-clock-skew-lastsynced-5661.md) display clamp MERGED #5674; epoch-skew LWW poisoning unfixed (user's clock)
- [#5675 font sync "Unknown error"](font-sync-download-unknown-error-5675.md) PR #5700; mkdir FUSED with id minting; `Unknown error` collapse UNFIXED
- [#5716 reference page count never synced](reference-page-count-sync-5716.md) MERGED #5727; per-book viewSettings cross NEITHER backend; no field-level merge; device verify pending
- [deleted_at OR cursor invariant](sync-deleted-at-cursor-invariant.md) load-bearing
- [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED; fix = rm readest_library.sqlite3
- [#5625 loadDocument parsererror fallback](loaddocument-xhtml-parsererror-5625.md) MERGED #5630 + foliate#70; device verify pending
## Build, Testing & CI
- [Nix FOD hash staleness](nix-fod-hash-staleness.md) MERGED #5779; new pnpmDeps.hash from the PR check's `got:` line, NEVER docker/OrbStack (user ban)
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md) · [Store listings in fastlane](store-listings-fastlane-5573.md) MERGED #5573; readest-promotions NOT live
- [worktree:new REBASES a PR branch](worktree-new-rebases-pr-force-push.md) pushing to a fork from it = FORCE push; cherry-pick onto the real head
- [Workflow-file pushes need SSH](push-workflow-file-needs-ssh-not-gh-oauth.md) gh OAuth token lacks `workflow` scope; fork-PR rebase-push also needs the SSH URL
## Platform Compat
- Resolved/stable → pointer index at end of [Platform Compat](platform-compat-fixes.md)
- [#5372/#2862 Play keeps All Files Access](play-all-files-access-restored-5372.md) MERGED #5378; NEXT submission fills the form
- [#5397 Photos save crash](ios-photos-add-usage-description-5397.md) MERGED #5405; device-verify pending
- [Android OAuth hangs on MS passkey page](android-oauth-passkey-no-credential-provider.md) no Credential Manager provider; wedges WebAuthn till reboot; NOT a CCT bug
- [APKs opened with Readest](android-intent-filter-pathpattern-needs-host.md) MERGED #5610, verify PENDING; `pathPattern` DEAD without `android:host`
- [#5799 BT HID hotplug recreates activity](android-configchanges-navigation-recreate-5799.md) MERGED #5804; `navigation` in gen manifest configChanges (upstream template lacks it, regen reintroduces); real hotplug verify PENDING
## Reader Features & UI
- Resolved/stable feature memories → [Reader Feature Fixes](reader-feature-fixes.md)
- [#5813 cover full screen from sidebar/Book Details](book-cover-fullscreen-viewer-5813.md) MERGED #5827, worktree removed; web verified, device verify pending; ImageViewer Escape = pre-existing; aria-labels are translated (don't select by English label)
- [Audiobookshelf phases 1+2](audiobookshelf-integration-phase1.md) PR #5801 OPEN (squashed on `feat/audiobookshelf`; dev keeps unsquashed history); Xiaomi-verified; iOS/CarPlay/e-ink verify pending
- [#5795 e-ink per-device CSS via data-eink](eink-per-device-css-data-eink-5795.md) MERGED #5803; `html[data-eink]` mirrored onto book docs; WenKai single 400 face = not a bug; comment POSTED; Boox verify PENDING
- [#5142/#5757 bookmark pull on fixed layout](bookmark-pull-fixed-layout-5142.md) `abe180cbd` on dev; gate = hasVerticalPanning; Xiaomi-verified via CDP synthetic touch
- [#5662 Alert sized off its own text](alert-flex-item-content-sizing-5662.md) MERGED; `w-full` wrapper LOAD-BEARING; needs browser test
- [#1582 translated text loses formatting](translation-inline-markup-1582.md) STILL OPEN; default `deepl` CORRUPTS markup
- [#5772 iframe translation observer](translation-iframe-observer-5772.md) MERGED; cross-document IntersectionObserver NOT broken (PR's root cause FALSE); `allTextNodes` INDEX-COUPLED
- [#5600 PDF quota toast on every selection](pdf-translation-quota-toast-5600.md) MERGED #5617; contextmenu auto-open + stale `translationEnabled` UNFIXED
- [#5823 Azure "Unable to fetch the translation"](azure-translate-regional-redirect-5823.md) reporter's bug = #5620 (merged, NOT in 0.12.1); PR #5826 MERGED (`a4358d22e`), worktree removed, issue CLOSED: regional bing host POST (www 302 -> cn = silent ECHO) + popup error detail; Mac system proxy hides the redirect from Tauri; `tauri dev` binary invisible to computer-use; worktree submodule is file:// (needs `protocol.file.allow=always` after a pin bump)
- [#5538 highlight resize orphan bubble](highlight-resize-orphan-note-bubble-5538.md) MERGED #5541; drag-race overlay UNFIXED
- [#5652/#5634 header vs footer dedup](reader-header-footer-dedup-5652-5634.md) MERGED #5708; `Aa` GONE so desktop has NO one-click settings; device verify pending
- [#5585 Instant Dictionary deselects](instant-dictionary-deselect-5585.md) MERGED #5730; clear `isTextSelected` BEFORE `view.deselect()`; device verify pending
- [#5667 e-ink highlight invisible in dark](eink-highlight-difference-mask-5667.md) MERGED #5735; difference-blend fill = INVERSION MASK; transientHighlight UNFIXED; device verify pending
- [Footnote popup revokes section image blobs](footnote-popup-revokes-section-blobs.md) MERGED #5756 + foliate#78; fix needs BOTH halves or sections leak; device verify pending
- [#5646 footnote popup selection toolbar](footnote-popup-selection-5646.md) MERGED #5744 + foliate#77; overlay-click ambiguity + quick-actions gaps OPEN
- [PR #5780 edit note from bubble popup (#4668)](pr-5780-inline-note-popup-edit-review.md) MERGED `e83fec7f2`; note bubbles NOT drawn on initial load = PRE-EXISTING main bug (NO issue filed)
- [#5776 book title/series data attrs](book-meta-data-attrs-5776.md) MERGED #5806; edited `seriesIndex` persisted as STRING fixed via `getSeriesIndex`; index 0 unrepresentable; device check pending
- [#5820 RSVP fine WPM entry](rsvp-fine-wpm-entry-5820.md) MERGED #5825; Chrome + Xiaomi verified; Chrome-MCP `key Escape` only blurs, deep link needs cold start, `pnpm exec dotenv` outside scripts
- [#5785 note popup markdown](note-popup-markdown-5785.md) MERGED #5805; `noteMarkdown` util, DOMPurify html+mathMl; OPEN: note links navigate the whole webview (pre-existing)
- [#5809 PDF cross-page selection](pdf-cross-page-selection-5809.md) MERGED #5831 (`4df8b37b7`), worktree removed, issue closed; gated `isFixedLayout && scrolled`; `segments` composite; mouse = html user-select:none freeze (Chromium 148+); Android = app handles in scroll mode (native handle touches never reach the page); Chrome + Xiaomi PR-APK VERIFIED (forward/back/backward/highlight/pan/paginated); iOS not covered
- [#5814 PDF copy joins line wraps into paragraphs](pdf-copy-join-lines-5814.md) MERGED #5828; geometry heuristics in `src/utils/pdfText.ts`; Chrome-web verified on 3 PDFs; nearly-full unindented last line still merges
- [#5822 PDF page labels as reference pages](pdf-page-labels-reference-pages-5822.md) MERGED foliate#81 + PR #5824; keep foliate branch `feat/pdf-page-labels` until next bump; device verify pending
- [#5815 markers over the dictionary sheet](lookup-popup-range-handles-5815.md) MERGED #5829; markers = app-drawn range-editor handles (Instant Highlight / highlight tap), NOT native; gated on `lookupPopupOpen`; Xiaomi verified; CDP long-press = `synthesizeTapGesture`, instant hold needs `adb input swipe`
- [e-ink `[class*=]` matchers](eink-class-substring-matchers.md) fire on `hover:`/`not-eink:` variants and beat inline styles; caused #4454 AND the #5667 black page-indicator pill
- [#4977 top bar blocks text selection](header-trigger-overlaps-text-4977.md) strip sized to content top; iPad web gap
- [#5480 Media Overlays narration](media-overlay-narration-5480.md) MERGED; 3 review findings UNFIXED
- [#5562 MO narration iOS native AVPlayer](media-overlay-ios-native-playout-5562.md) MERGED; Swift compiled ONLY by ios build; verify PENDING
- [#5501 Apple Pencil page turner](apple-pencil-page-turner-5501.md) MERGED #5511; verify PENDING
- [Mobile sheet virtuoso first-paint blank](mobile-sheet-virtuoso-first-paint-blank.md) PRE-EXISTING · [PR #5389 library full-text search review](pr-5389-library-search-review.md) plan in .agents/plans
- [Word Lens en-hu pack](wordlens-en-hu-pack-5738.md) MERGED #5738, PUBLISHED to R2 2026-08-20; MERGING DOES NOT PUBLISH, `pnpm wordlens:sync` is manual
- [Readest Voice self-hosted TTS](selfhosted-premium-tts-plans.md) APPROVED 2026-07-08; not started
- [PR #5690 TTS download queue](tts-download-queue-5690.md) MERGED 2026-08-16, Xiaomi verified; non-pt-BR i18n pending
- [#4584 tap-death](issue-4584-tap-death-investigation.md) UNFIXED; likely WebView-148 · [#5353 italic last glyph clipped](italic-synthetic-oblique-clip-5353.md) WebView regression, not Readest code
- [#5250 invert img dead w/ overrideColor](invert-img-dark-override-5250.md) PR #5383 open, VERIFIED
- [#5633 iOS image zoom blurry](ios-imageviewer-zoom-blur-5633.md) MERGED #5639; TableViewer same bug UNFIXED; verify pending
- [#5635 Auto Scroll progress frozen](autoscroll-progress-relocate-maxwait-5635.md) MERGED #5676 + foliate#72; jitter (item 1) OPEN
- [#5711 fixed-attachment garble + negative-margin bleed](css-fixed-attachment-negative-margin-5711.md) MERGED #5729; body corner-logo over footer = paginator bg mirroring, OPEN
- [#5641 Chrome-Android FXL text autosizing](fxl-chrome-android-text-autosizing-5641.md) MERGED #5659; verify pending; fix = text-size-adjust none
- [#5582 SE wide word gaps](se-text-wrap-pretty-justify-5582.md) MERGED #5718; device visual verify pending; fix = `text-wrap-style: auto` gated on justify
- [#5749 iOS weak hyphenation](hyphenation-engines-5749.md) OPEN; WebKit dict SEALED; only fix = JS soft-hyphen injection + offset normalization
- [#5750 TTS pause inconsistent](tts-pause-inconsistency-5750.md) MERGED #5753; device verify pending; `pnpm test` MISSES browser tests
- [#5767/PR #5768 TTS offline shared-sentence fix](tts-offline-shared-sentence-5768.md) MERGED (61c921542); Xiaomi VERIFIED; OPEN: empty-section Downloaded flip, needs follow-up issue
- [#5414 Edge silence untrimmed on iOS](edge-tts-baked-silence-ios-native-5414.md) MERGED #5417; verify pending · [#5230 Edge TTS mid-book stall](edge-tts-tauri-ws-hang-5230.md) MERGED #5534
- [Proofread gate = reflowable formats](proofread-gate-reflowable-formats.md) selection rules born dead (UNFIXED)
- [OPDS fixes](opds-fixes.md) aggregator: parsing, search, auth, auto-download, Calibre quirks
- [#5583 download format filter](opds-download-format-filter-5583.md) PR #5593
- [#5698 Komga OPDS 403](opds-komga-origin-403-5698.md) MERGED #5765; empty-Origin opt-out needs `unsafe-headers`; 28 of 29 plugin-http sites still send `tauri://localhost`
- [#5746 auto-download confirm + reorder](opds-autodownload-confirm-reorder-5746.md) MERGED #5760; no `touch-target` on drag handles over clickable cards
- [#5645 self-update crash on KOReader 2026.07+](koplugin-selfupdate-unpackarchive-5645.md) PR #5656; Device:unpackArchive DROPPED upstream
- [#5745 CBZ split-chapter folder order](cbz-split-folder-page-order-5745.md) MERGED #5762 + foliate#79; use `pnpm worktree:rm` for submodule worktrees
## Library Fixes
- [#5650 CDN 52x retry + metadata backfill](novel-import-transient-fetch-metadata-5650.md) MERGED; chapter TRUNCATION still UNFIXED
- [#5596 long-press select double-toggles](longpress-contextmenu-double-fire-5596.md) MERGED #5621, verify pending
- [#5601 bulk folder import exhaustion](bulk-folder-import-exhaustion-5601.md) #5607+#5615 MERGED, verified; Android `allow_paths_in_scopes` silent no-op UNFIXED
- [#5680 Read-in-place uncheck](readinplace-uncheck-unregister-5680.md) MERGED #5685; drag-drop ingress MUST pass real registration state, else silent unregister
- [#5360 Wayland tap kills native menu](wayland-tap-context-menu-5360.md) MERGED #5467; verify pending
## Networking & LAN
- [LocalSend integration](localsend-integration.md) MERGED #5611; fork `readest/localsend`; mTLS needs `WebConfig{upload:true}`; commands need 3-place ACL
- [koplugin LocalSend receive+send](koplugin-localsend-receive.md) MERGED #5687; static-musl BINARY+subprocess (Kindle glibc); fork pinned 3cae1825; ANDROID exec IMPOSSIBLE
- LocalSend discovery was DEAD 3 ways — MERGED #5626 + fork rev 37219949; rev bumps rebase BOTH patches
## Architecture & Patterns
- [Tauri Channel progress lands AFTER invoke resolves](tauri-channel-progress-after-invoke-resolves.md) MERGED #5736; latch every onProgress/cleanup pair; `cancel()` not `flush()`
- foliate-js submodule `packages/foliate-js/`; multiview paginator preloads adjacent sections
- Markdown: [.md support #774](markdown-md-support-774.md); resume position #4862; footnotes #5074; [#5279 YAML frontmatter](markdown-yaml-frontmatter-5279.md) MERGED #5344; dedup race UNFIXED
- [md titled after first H1, not the file](markdown-title-first-h1-over-filename.md) PR #5653; existing libraries keep their titles
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding; `transformStylesheet()` rewrites EPUB CSS
- TTS `#ttsSectionIndex`; insets: native plugin → useSafeAreaInsets → styles; Dropdowns `DropdownContext`
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) · [Theorem competitor analysis](theorem-competitor-feature-analysis.md)
- [Design system → DESIGN.md](feedback_design_system_doc.md) never `pl/pr/ml/mr` (RTL)
## Workflow & Feedback
- [Always verify on Xiaomi](feedback-always-verify-on-xiaomi.md) device 368b0948 (VPN'd); CDP+deep-link recipe; md5-check the device APK (dev builds report 0.12.1); suites alone repeatedly missed device bugs
- [Slice-in-loop NOT O(n^2)](review-perf-slice-not-quadratic.md) V8 SlicedString · [Commit messages English-only](feedback-commit-message-english-only.md) no CJK, no em/en dashes
- PR flow: [rebase onto origin/main](feedback_pr_rebase.md); [fresh branch per PR](feedback_pr_new_branch.md); [always `pnpm worktree:new`](feedback_use_worktree.md); [don't push till confirmed](feedback_dont_push_every_change.md); pre-push hook runs full vitest (~2.5 min), push in background
- [Test file filter](feedback_test_file_filter.md) `pnpm test <path>` no `--` · [No test seams in prod](feedback_no_test_seams_in_prod.md) · [no lookbehind regex](feedback_no_lookbehind_regex.md)
- [No mock-only platform tests](feedback-no-mock-only-platform-tests.md) skip call-sequence tests over mocked IPC · [No config-mirror tests](feedback-no-config-mirror-tests.md) validate via `cargo check`
- i18n: [en plurals manual](feedback_en_plurals_manual.md); [i18n:extract prunes keys](i18n-extract-prunes-keys.md) (~56 drift keys); {{provider}} case suffixes #5102; [label rename = key rename](i18n-label-rename-workflow.md)
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) `overrides:` · [deps security recipe](deps-security-overrides-workflow.md) MERGED #5335+#5518 · [gstack upgrade](feedback_gstack_upgrade.md) project-local install
- [Reserved route filenames under src/app/](nextjs-app-dir-reserved-route-filenames.md) a helper named `layout.ts` = route layout; build-only failure, lint is GREEN
- [Reader chrome changes need e2e](verify-reader-chrome-needs-e2e.md) `ReaderPage.ts` hard-codes toolbar aria-labels; grep `e2e/` before deleting a reader button
- [stat_pages slow query + disk growth (2026-08-23)](stat-pages-slow-query-disk-growth.md) Small instance SWAPPING (root cause of 26 s outliers; DB mean 3.7 ms); stat_pages 16.5 GB growing ~9 GB/mo; RPC upsert MERGED #5832 (migration 019 in prod); koplugin paged pull MERGED #5833; R2 tiering MERGED #5835 (migration 020 NOT in prod yet: apply BEFORE next web deploy or stats pulls 500; then bucket+secret+validate+enable per runbook); spec local-only at .claude/plans/2026-08-23-stats-r2-tiering-spec.md (#5834 deleted: prod data); Mgmt-API read-only SQL recipe
- [No prod metrics in public issues/PRs](feedback-no-prod-metrics-in-public.md) #5834 DELETED by user for exposing prod data; specs stay local (~/.gstack/projects/readest-readest/specs/), NOT in the tracked .claude/ tree; PR #5832/#5833 bodies scrubbed 2026-08-23 (commit messages untouched)
