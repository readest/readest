# Readest Project Memory

Index only — one line per memory. Detail lives in the topic files; do not restate it here.

## Key Reference Documents (aggregators)
- [Bug Patterns](bug-patterns.md) · [CSS & Style](css-style-fixes.md) · [TTS](tts-fixes.md)
- [Layout & UI](layout-ui-fixes.md) · [Platform Compat](platform-compat-fixes.md) · [Annotator & Reader](annotator-reader-fixes.md)
- [Sync Fixes](sync-fixes.md) · [Reader Feature Fixes](reader-feature-fixes.md)
- [Paginator & Scroll Fixes](paginator-scroll-fixes.md) · [Build & CI Recipes](build-ci-recipes.md)
- [Full index archive](memory-index-archive.md) verbatim pre-2026-10-09…

## Feedback & Working Rules
- [Always verify on Xiaomi; keep it on the newest APK](feedback-always-verify-on-xiaomi.md) main or latest fix worktree · [Pin adb serial for every device action](feedback-pin-adb-serial.md) devices get swapped mid… · [Codex: Chrome via Computer Use](feedback-chrome-computer-use.md) Codex only
- [Ops data → gitignored private-*.md](feedback-private-memory-for-ops-data.md) memory dir is tracked · [No internal data in public text](feedback-no-internal-data-in-public.md) · [No competitor names in public text](feedback-no-competitor-names-in-public.md)
- [PR watch = reviews + CI checks + conflicts](feedback-pr-watch-fix-conflicts.md) · [PR review trust policy](feedback-pr-review-trust-policy.md) ALWAYS watch reviews · [PR reviews: fix and push to the PR](feedback-pr-review-no-posting-offer.md) rework whole PR if needed
- [Show email drafts before sending](feedback-show-email-draft-before-sending.md) lead with the direct answer
- [Reply Desk artifact](reply-desk-artifact.md) loops' approval page · [Bounded waits only](feedback-bounded-waits.md) cap shells at 2 min
- [git stash is shared across worktrees](feedback-stash-shared-across-worktrees.md) never stash/pop for revert checks · [Never pkill Chrome helpers](feedback-never-pkill-chrome-helpers.md)
- [Tests running git must clear GIT_* env](test-git-commands-inherit-hook-git-dir.md) pre-push GIT_DIR rewrote the real repo · [Targeted tests: `pnpm test --run <files>`](feedback-pnpm-test-file-filter.md) · [No simulated-wait loops in unit tests](feedback-no-simulated-wait-loops-in-unit-tests.md) slow pre-push and CI
- [Ubuntu box: no killall -3 gnome-shell](ubuntu-gnome-shell-restart-fail-whale.md) · [Never restore a settings backup after the user acts](feedback-no-restore-settings-after-user-acts.md) · [Toolbars never change content layout](feedback-toolbars-never-change-layout.md)

## Safety & Security
- [GHSA sweep 2026-10-15](private-security-advisories-sweep-2026-10-15.md) local only · [Supabase exit: host migration plan](supabase-exit-host-migration.md) step 1 MERGED #6729
- [Supabase signing keys notes](private-supabase-signing-keys-migration-2026-10-12.md) local only · [Supabase outage notes](private-supabase-outage-2026-08-31-compute-and-bloat.md) local only
- [API route audit notes](private-api-route-auth-audit-2026-08.md) local only · [Stripe webhook notes](private-stripe-webhook-missing-charge-refunded.md) local only · [Stripe checkout notes](private-stripe-checkout-500-storage-purchase.md) local only
- [Play 0.12.10 shipped the macOS App Store build](play-build-stripe-fallback-cn-xiaomi.md) DIST_CHANNEL=appstore · [Play subscription notes](private-google-sub-row-written-plan-not-applied.md) local only · [Apple storage purchase notes](private-apple-iap-lost-storage-purchase-restore-verify.md) local only
- [0.12.1 App Review crash](appstore-review-crash-0121-aswebauth-anchor.md) UNFIXED · [#6521 iPad PDF exits: huge 1-bit scans](pdf-huge-1bit-image-gpu-oom-6521.md) · [Send email sender notes](private-send-email-sender-trust-2026-11.md) local only

## Paginator & Scroll
- [#6646 footer slider jitter](progress-slider-jitter-6646.md) MERGED #6766 · [Fixed-layout pageinfo is a location count](fixed-layout-pageinfo-is-location.md) use progress.section · [Huge/link-dense sections hang (KJV, #1711)](huge-section-hangs-kjv-1711.md) #6678 MERGED
- [iOS scrolled-PDF lag, 2752-page strip](pdf-scroll-ios-lag-dom-size.md) · [Scroll overlap = PDF only](scroll-overlap-fixed-layout-only.md) MERGED #6621 · [#5179 layered-turn toolbar sync](pr-5179-layered-turn-toolbar-sync.md) MERGED
- [#6407 iOS pan lock drifts on momentum swipe](ios-pan-lock-momentum-6407.md) · [#6484 Webtoon zoom seam](webtoon-zoom-seam-6484.md) · [#7100 PDF blurry on iOS: detail canvas](pdf-detail-canvas-sharp-text-7100.md) MERGED #7300
- [#7397 PDF push seam, Android fractional dpr](pdf-push-detail-seam-7397.md) innerWidth 392 vs visualViewport 392.727; #7398 MERGED 176bbf25e
- [Scanned PDF strip seams in dark theme](pdf-theme-strip-seams.md) #7455 + #7465 MERGED (foliate #155/#156/#157)
- [PDF text-layer <br>s stack at the left edge](pdf-text-layer-br-stacking-7563.md) margin drags + popup/handles; foliate#167 + #7563 MERGED
- [PDF soft/shifted under a held curl](pdf-curl-stale-native-sheet.md) stale sheet #7463 MERGED; 1px touch scroll foliate#158-#160 MERGED + readest #7469 MERGED fbb9d039a
- Resolved/stable → [Paginator & Scroll Fixes](paginator-scroll-fixes.md)

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` EPUB CSS hub · `packages/foliate-js/paginator.js` · `src/services/tts/TTSController.ts`
- `src/hooks/useSafeAreaInsets.ts` · `src/app/reader/components/FoliateViewer.tsx` · `.../annotator/Annotator.tsx`

## Sync Notes
- [Nov 9-10 outage notes](private-supabase-sync-pull-indexes-2026-11-10.md) local only
- [#6700 sign-out logged out all devices](signout-global-scope-6700.md) fixed #6709 · [#6663 deletes undeleted by pull merge](book-tombstone-updatedat-6663.md) MERGED #6682
- [#6623 shelf % stale after quit](library-progress-lost-on-quit-6623.md) · [#6544 note text wiped on reopen](note-edit-clock-skew-sync-wipe-6544.md) server-stamped insert
- [New import invisible on peers](books-sync-inflight-change-dropped.md) · [Uploads with Books sync off = orphan cloud files](upload-without-books-sync-orphan-files.md)
- [#5570 KOSync/BookOrbit custom headers](custom-headers-kosync-bookorbit-5570.md) MERGED · [#5661 "Synced in an hour"](sync-clock-skew-lastsynced-5661.md) clamp MERGED #5674
- [#5675 font sync "Unknown error"](font-sync-download-unknown-error-5675.md) PR #5700 · [#5931 S3 Full Sync never restores covers](pr-6116-cover-repair-review.md) MERGED #6116 · [#6427 OneDrive create folder 400](onedrive-approot-create-folder-400-6427.md)
- [#7503 Kavita KOSync zero-based percentage](kavita-kosync-zero-based-percentage-7503.md) MERGED #7513; device "Kavita" gate, exact totals for page compare
- [#5980/#6051 KOSync opened the wrong chapter](kosync-percentage-reanchor-impossible-path-5980.md) REGRESSION from #5111 · [xcfi emoji offsets + non-linear spine](xcfi-astral-offsets-nonlinear-spine.md)
- [Data Flow: descriptive source/sink connectors](data-flow-hub-source-sink.md) recordFlow + read-only checks, NOT a coordinator; 7 commits not pushed
- [#6933 macOS 26+ forked worker getaddrinfo](koplugin-macos-fork-getaddrinfo-6933.md) MERGED #7021 · [Cloud delete missed hash-named files](storage-delete-hash-key-and-desktop-cache-7063.md) #7063 + #7066 MERGED
- [#6816 synced cover stuck after failed download](cover-sync-failed-download-stuck-6816.md) MERGED #7116 · [#7186 koplugin "logged out daily" + QR sign-in](koplugin-login-label-qr-signin-7186.md)
- [#6685 exit leaves sync workers running](koplugin-exit-orphan-sync-workers-6685.md) MERGED #7293 · [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED
- [koplugin pushes fail on slow TLS + open race](koplugin-slow-tls-push-and-open-race.md) UNFIXED · [Kobo BookDrop "no free port" every launch](koplugin-bookdrop-kobo-free-port.md)
- Resolved/stable → [Sync Fixes](sync-fixes.md)

## Infra Cost
- [Cloudflare cost breakdown 2026-11](private-cloudflare-cost-breakdown-2026-11.md) local only · [Supabase host drain 2026-11](private-supabase-host-drain-2026-11.md) local only

## Build, Testing & CI
- [Next 16.4 enables Turbopack build cache](next-16-4-turbopack-build-cache-default.md) Vercel warm cache panic · [macOS narration gap capture](macos-narration-audio-capture-recipe.md) BlackHole + ffmpeg
- [Leaf5C adb handwriting demo](leaf5c-adb-handwriting-demo.md) · [Ink sync reply drops strokes](ink-sync-reply-drops-strokes.md) · [Handwriting/drawing #6674](handwriting-ink-6674.md) MERGED · [BOOX pen SDK build gotchas](boox-pen-sdk-build-gotchas.md)
- [iOS 16 layout repro: Playwright 1.33 WebKit](ios16-safari-layout-repro-old-webkit.md) · [Drive the iOS sim WebView via iwdp](ios-sim-webview-drive-via-iwdp.md) · [iOS ad hoc build via ASC API](private-ios-ad-hoc-build-via-asc-api.md) local only
- [iOS device build from a worktree](ios-worktree-device-build-gotchas.md) · [iOS device screenshots + dev-ios install](ios-device-screenshot-and-install-recipe.md) devicectl
- [KOReader push needs a matching plugin](koreader-push-needs-matching-plugin.md) use deploy · [Kindle KOReader e2e gotchas](koreader-kindle-e2e-gotchas.md) · [macOS deep-link test recipe](macos-deeplink-test-recipe.md)
- [Ad-hoc visual checks need theme tokens](adhoc-visual-check-daisyui-theme-tokens.md) · [worktree:new PR = rebased branch](worktree-new-pr-rebases-onto-main.md) conflicts if PR merged main; push from fork branch
- [Nix FOD hash staleness](nix-fod-hash-staleness.md) BLANK the hash first · [No CI run after a conflicted PR push](pr-checks-not-triggered-after-conflict.md) · [Workflow-file pushes need SSH](push-workflow-file-needs-ssh-not-gh-oauth.md)
- [KOSync repro on dev-web: mock server](kosync-dev-web-mock-server-recipe.md) `_timestamp`; curl --noproxy, localhost not 127.0.0.1 · [Drive the macOS tauri dev window](desktop-dev-window-webdriver-recipe.md) webdriver :4445
- [OPDS auto-download repro on dev-web](opds-autodownload-dev-web-recipe.md) settings via IndexedDB; clear 5-min feed cache via CDP
- [Drive RSVP on dev-web with Playwright](rsvp-playwright-dev-web-recipe.md) View Options menu, not Shift+V; temp config on :3007
- [E0463 tauri_macros on Xcode 27.1](rust-objcopy-misaligned-dylib-xcode27.md) rustup update stable
- [zip Dependabot alerts need tauri fork ≥ 2.12](zip-alerts-blocked-on-tauri-fork-2-12.md) updater 2.14.1; npm alerts fixed #7583
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md)

## Platform Compat
- [#6383 custom data location transfers forbidden](custom-data-location-transfer-forbidden-6383.md) REGRESSION from #6343 · [#6488 backups dropped reading stats](backup-reading-stats-6488.md) · [#6144 0.12.8 Linux launch failures](arch-cef-package-launch-crash-6144.md)
- Resolved/stable → [Platform Compat](platform-compat-fixes.md)

## Reader Features & UI
- [iPhone Duo series + #7146 orientation lock](iphone-duo-6307-column-gap.md) #7146 MERGED · [#6848 macOS paired M4B silent](macos-paired-audiobook-asset-range-cap-6848.md) · [#6989 iOS narration in place](narration-ios-file-window-6989.md) MERGED #7019
- [MiMo Custom TTS via chat completions](custom-tts-mimo-chat-completions.md) MERGED · [#258 custom OpenAI-compatible TTS (BYOK)](custom-tts-byok-258.md) MERGED #6746 · [Edge TTS endpoint moved](edge-tts-msedgeservices-endpoint-6722.md) MERGED #6722
- [#6719 iOS 16 share sheet never opened](ios16-sharekit-url-parse-6719.md) MERGED #6770 · [#4937 Android Lookup App picker](android-lookup-app-picker-4937.md) MERGED #7272 · [Android lookup app reset: vivo vs stock](android-lookup-app-reset-vivo.md)
- [#6723 center+indent-0 !important](text-align-center-important-6723.md) MERGED #6763 · [#6656 blockquote paragraphs kept margins](blockquote-paragraph-margins-6656.md) MERGED #6759 · [Book li margins: keep like calibre](list-item-end-margin-bullets.md) owner rule; MERGED #7338
- [#5830 quote cards](quote-card-5830.md) MERGED #6701 · [#6637 iOS OPDS http covers blocked](opds-http-cover-mixed-content-6637.md) · [primaryLanguage legacy raw values](book-primarylanguage-legacy-raw-values.md)
- [EPUB meta-cover href picked wrong cover](epub-meta-cover-href.md) · [Reading widget E-ink black-on-dark](reading-widget-eink-dark-mode.md) · [#5233 sentence-by-sentence + A-B repeat](tts-sentence-step-ab-repeat-5233.md) PR #6627 OPEN
- [#6618 dictionary text unreadable in dark](dict-dark-mode-text-colors-6618.md) · [#6347 series index cover badge](series-index-badge-6347.md) · [#6607 Plans page dropped the book](plans-page-back-to-reader-6607.md)
- [#5544 AI context dictionary](context-dictionary-5544.md) · [#6574 image long-press menu](image-long-press-menu-6574.md) · [Shared listener dies in reader iframes](sentry-iframe-shared-listener-dead.md) MERGED #6771
- [#6400 inverted image blank on Android](invert-image-blank-android-6400.md) · [#6568 iOS annotation cards expand on scroll](ios-touchstart-hover-annotation-expand-6568.md) · [Calibre plugin columns never filterable](calibre-plugin-custom-columns-filter.md)
- [#6527 Hardcover on reader sync row](hardcover-sync-row-6527.md) MERGED · [#6433/#6457 media keys + desktop Now Playing](desktop-now-playing-6457.md) · [#6360 BookDrop own section](bookdrop-own-section-6360.md)
- [#6444 CarPlay no resume after nav prompt](carplay-interruption-resume-6444.md) · [#7168 CarPlay hidden app stops car music](carplay-hidden-app-music-stops-7168.md) NOT reproduced · [#6271 BookDrop rang on reader open](bookdrop-cue-priming-rang-on-reader-open-6271.md) MERGED #6277
- [#6199 external links opened on a stray tap](external-link-confirm-6199.md) MERGED #6254 · [Older open reader issues](reader-open-issues.md) #5887 #5646 #5785 #1582…
- [#5795 per-device CSS](eink-per-device-css-data-eink-5795.md) Boox verify PENDING · [#5667 highlight invisible dark](eink-highlight-difference-mask-5667.md) · [#6141 ghost highlight after adjust+delete](annotation-edit-ghost-highlight-6141.md) MERGED #6357
- [Reader overlay z-layers](annotator-overlay-z-layers.md) · [#5939 edge gestures vs mid-touch selection](edge-gesture-selection-after-touchstart-5939.md) MERGED #5958 · [#6048 reading ruler on e-ink](reading-ruler-eink-6048.md) PR #6055 UNVERIFIED
- [#6107 two-column curl hinged at the spine](two-column-spine-curl-6107.md) REVIEWED not merged · [Readest Voice TTS](selfhosted-premium-tts-plans.md) v2 PROPOSED · [TTS voice preview + Voice Library](tts-voice-preview-library.md) MERGED #7322
- [Reader remount: section doc briefly rootless](reader-remount-rootless-section-doc.md) MERGED #6758 · [Character tracking direction](character-tracking-direction.md) #6690 CLOSED
- [#6865 translator Thinking Default/Off](translator-thinking-off-6865.md) MERGED #7275 · [#7276 Ignore publisher font names](ignore-publisher-fonts-7276.md) MERGED #7298 · [RSVP let the screen sleep](rsvp-screen-wake-lock.md) MERGED #7200
- [#789/#6613 Vocabulary builder + Word Lens](vocabulary-builder-789-6613.md) PR #7284 OPEN · [Vocabulary ↔ AnkiDroid Sync (#789)](anki-link-ankidroid-789.md) MERGED #7328; desktop AnkiConnect next
- [Sanitizer unwraps <rb>; rb ruby repros need Allow JavaScript](sanitizer-strips-rb-ruby.md) #7405 MERGED; Playwright translation-payload recipe
- [Chromium Selection.modify boundary quirks](chromium-selection-modify-boundary-quirks.md) vim find #7282 MERGED · [open-book-in-reader skips guarded close](open-book-in-reader-skips-guarded-close.md) UNFIXED
- [#7364 narration staging OOM via Android JSON IPC](narration-stage-ipc-oom-7364.md) MERGED #7367 · [#7360 E-Ink two-book fix unlanded](eink-all-open-books-unlanded.md) local branch unpushed
- [#6792 single-section chapter pull](single-section-chapter-pull-6792.md) MERGED #7422; sync undoes backward nav (unfiled)
- [RTL books already follow dc:language; UI RTL menu-only](rtl-book-direction-from-language.md) #7478 narrowed
- [#7482 highlight from paragraph start: CFI start between children](cfi-range-start-between-children-7482.md) foliate #168+#169, readest #7515 MERGED; readest pins off-main foliate (`-on-pin` branch)
- [#1750 Notion sync](notion-sync-pr-5949-review.md) MERGED #5949 · Resolved/stable → [Reader Feature Fixes](reader-feature-fixes.md)

## Library Fixes
- [#7312 approve sender blocked by CORS](send-approve-sender-cors-7312.md) MERGED · [#6662 page count at import + Pages sort](import-page-count-6662.md) #6774 + #6775 MERGED · [localeCompare options = per-call collator](localecompare-options-collator-perf.md) MERGED #6693
- [#5955 not all books auto-imported](autoimport-skips-deleted-books-5955.md) NOT reproducible · [#6703 re-key tombstone, last import wins](rekey-tombstone-last-import-wins-6703.md) MERGED
- [#6104 bookshelf clicks reopened the URL-launched book](deeplink-coldstart-hijacks-spawned-windows-6104.md) · [#5650 CDN 52x retry + metadata backfill](novel-import-transient-fetch-metadata-5650.md) MERGED

## Networking & LAN
- [CrossPoint <-> Readest plugin](crosspoint-integration-feasibility-2026-09.md) MERGED #6547 · [LocalSend integration](localsend-integration.md) MERGED #5611 · [Readest connector in crosspoint-sync](crosspoint-sync-readest-connector.md) DEFERRED
- [CrossPoint 2.0 clippings ↔ highlights](crosspoint-2-clippings-highlights.md) #7317 + #7319 MERGED; X4 e2e recipe · [Notes sync loop on client/server skew](notes-sync-crosspoint-skew-loop.md) MERGED #7326; deploy web before native

## Architecture & Patterns
- [Architecture notes](architecture-notes.md) foliate submodule, styles · [Readest on Kindle feasibility](readest-on-kindle-feasibility.md) handoff in .claude/plans

## Workflow & Feedback
- [IAP Family Sharing state](iap-family-sharing-state.md) only 1 GB storage on · [Dialog swallows keydown: use onKeyDownCapture](dialog-keydown-capture-phase.md) · [dev-web stats pull fails on local R2](dev-web-stats-pull-local-r2.md)
- [Annotations hub verify needs 60+ notes](verify-annotations-hub-needs-long-list.md) · [Reader chrome changes need e2e](verify-reader-chrome-needs-e2e.md) · [#6417 koplugin sync response files pile up](koplugin-stale-sync-responses-6417.md)
- [Native curl capture timing 2026-10-25](native-curl-capture-timing-2026-10-25.md) Page Flip MERGED #7160 · [Curl/Flip chrome flashes: invalidate lifted cover](curl-toolbar-flash-invalidate-cover.md) MERGED #7343; CDP window.ipc hook
- [#7171 native cover above the keyboard](native-cover-above-ime-7171.md) MERGED #7191 · [iOS native paper curl #7046](ios-native-paper-curl-7046.md) MERGED c811741af · [Carousel spine lost on remount](carousel-spine-lost-on-remount.md) MERGED #6624+#6625
