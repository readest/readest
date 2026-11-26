# Readest Project Memory

Index only — one line per memory. Detail lives in the topic files; do not restate it here. `private-*` files are local only (git-ignored).

## Key Reference Documents (aggregators)
- [Bug Patterns](bug-patterns.md) · [CSS & Style](css-style-fixes.md) · [TTS](tts-fixes.md)
- [Layout & UI](layout-ui-fixes.md) · [Platform Compat](platform-compat-fixes.md) · [Annotator & Reader](annotator-reader-fixes.md)
- [Sync Fixes](sync-fixes.md) · [Reader Feature Fixes](reader-feature-fixes.md)
- [Paginator & Scroll Fixes](paginator-scroll-fixes.md) · [Build & CI Recipes](build-ci-recipes.md)
- [Full index archive](memory-index-archive.md) verbatim pre-2026-10-09…

## Feedback & Working Rules
- [Always verify on Xiaomi; keep it on the newest APK](feedback-always-verify-on-xiaomi.md) · [Pin adb serial for every device action](feedback-pin-adb-serial.md) · [Codex: Chrome via Computer Use](feedback-chrome-computer-use.md) Codex only
- [Ops data → gitignored private-*.md](feedback-private-memory-for-ops-data.md) · [No internal data in public text](feedback-no-internal-data-in-public.md) · [No competitor names in public text](feedback-no-competitor-names-in-public.md)
- [PR watch = reviews + CI checks + conflicts](feedback-pr-watch-fix-conflicts.md) · [PR review trust policy](feedback-pr-review-trust-policy.md) · [PR reviews: fix and push to the PR](feedback-pr-review-no-posting-offer.md) rm worktree after merge
- [CodeRabbit loop cap on big PRs](feedback-coderabbit-review-loop-cap.md) one fix round per pass, then only Major/Critical
- [Show email drafts before sending](feedback-show-email-draft-before-sending.md) lead with the direct answer
- [Owner runs the web deploy](feedback-owner-runs-web-deploy.md) merge and report; no `pnpm deploy`
- [Reply Desk artifact](reply-desk-artifact.md) loops' approval page · [Bounded waits only](feedback-bounded-waits.md) cap shells at 2 min
- [git stash is shared across worktrees](feedback-stash-shared-across-worktrees.md) · [Submodule deinit in a worktree hits the main checkout](worktree-submodule-deinit-shared-config.md) worktree:rm too · [Never pkill Chrome helpers](feedback-never-pkill-chrome-helpers.md)
- [test:rust transfer_file fails behind the shell proxy](test-rust-transfer-file-proxy-env.md) unset http_proxy
- [Tests running git must clear GIT_* env](test-git-commands-inherit-hook-git-dir.md) · [Targeted tests: `pnpm test --run <files>`](feedback-pnpm-test-file-filter.md) · [No simulated-wait loops in unit tests](feedback-no-simulated-wait-loops-in-unit-tests.md)
- [Leave the tauri fork alone unless needed](feedback-leave-tauri-fork-unless-needed.md) fix in the readest repo first
- [Ubuntu box: no killall -3 gnome-shell](ubuntu-gnome-shell-restart-fail-whale.md) · [Never restore a settings backup after the user acts](feedback-no-restore-settings-after-user-acts.md) · [Toolbars never change content layout](feedback-toolbars-never-change-layout.md)

## Safety & Security
- [GHSA sweep 2026-10-15](private-security-advisories-sweep-2026-10-15.md) · [Supabase exit: host migration plan](supabase-exit-host-migration.md) step 1 MERGED #6729
- [Supabase signing keys](private-supabase-signing-keys-migration-2026-10-12.md) · [Supabase outage](private-supabase-outage-2026-08-31-compute-and-bloat.md)
- [API route audit](private-api-route-auth-audit-2026-08.md) · [Stripe webhook](private-stripe-webhook-missing-charge-refunded.md) · [Stripe endpoint API version](private-stripe-webhook-endpoint-api-version-acacia.md) · [Stripe checkout](private-stripe-checkout-500-storage-purchase.md)
- [Play 0.12.10 shipped the macOS App Store build](play-build-stripe-fallback-cn-xiaomi.md) · [Play subscription](private-google-sub-row-written-plan-not-applied.md) · [Apple storage purchase](private-apple-iap-lost-storage-purchase-restore-verify.md)
- [Stripe gift card products](private-stripe-gift-card-products.md) live 49.99/99.99, giftDays unread, badge icons
- [Launch directory listings](private-launch-directories.md) check before submitting Readest anywhere
- [0.12.1 App Review crash](appstore-review-crash-0121-aswebauth-anchor.md) UNFIXED · [#6521 iPad PDF exits: huge 1-bit scans](pdf-huge-1bit-image-gpu-oom-6521.md) · [Send email sender](private-send-email-sender-trust-2026-11.md)

## Paginator & Scroll
- [#6646 footer slider jitter](progress-slider-jitter-6646.md) MERGED · [Fixed-layout pageinfo is a location count](fixed-layout-pageinfo-is-location.md) · [Huge/link-dense sections hang (KJV, #1711)](huge-section-hangs-kjv-1711.md) MERGED
- [iOS scrolled-PDF lag, 2752-page strip](pdf-scroll-ios-lag-dom-size.md)
- [#6407 iOS pan lock drifts on momentum swipe](ios-pan-lock-momentum-6407.md) · [#6484 Webtoon zoom seam](webtoon-zoom-seam-6484.md) · [#7100 PDF blurry on iOS: detail canvas](pdf-detail-canvas-sharp-text-7100.md) MERGED
- [#7397 PDF push seam, Android fractional dpr](pdf-push-detail-seam-7397.md) MERGED #7398; #7987 = same on 0.12.20
- [Scanned PDF strip seams in dark theme](pdf-theme-strip-seams.md) MERGED
- [PDF text-layer <br>s stack at the left edge](pdf-text-layer-br-stacking-7563.md) MERGED
- [PDF soft/shifted under a held curl](pdf-curl-stale-native-sheet.md) MERGED #7463 #7469
- Resolved/stable → [Paginator & Scroll Fixes](paginator-scroll-fixes.md)

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` EPUB CSS hub · `packages/foliate-js/paginator.js` · `src/services/tts/TTSController.ts`
- `src/hooks/useSafeAreaInsets.ts` · `src/app/reader/components/FoliateViewer.tsx` · `.../annotator/Annotator.tsx`

## Sync Notes
- [Nov 9-10 outage](private-supabase-sync-pull-indexes-2026-11-10.md)
- [Pagebound sync + #7480 bracketed titles](pagebound-sync-6511.md) MERGED; same-author follow-up UNLANDED
- [#7970 Hardcover showcase PR + web cover COEP bug](hardcover-showcase-7970-web-cover-coep.md) hardcover-docs#286 PENDING; covers UNFIXED
- [#7538 sign-in every launch: auth-cf proxy fallback](signin-every-launch-auth-proxy-7538.md) MERGED #7540
- [#6623 shelf % stale after quit](library-progress-lost-on-quit-6623.md) · [#6544 note text wiped on reopen](note-edit-clock-skew-sync-wipe-6544.md)
- [#7814 books push over 1 MB body limit](sync-books-push-body-limit-7814.md) FIXED #7815; retry gap #7824 OPEN
- [New import invisible on peers](books-sync-inflight-change-dropped.md) · [Uploads with Books sync off = orphan cloud files](upload-without-books-sync-orphan-files.md)
- [#5675 font sync "Unknown error"](font-sync-download-unknown-error-5675.md) PR #5700 · [#6427 OneDrive create folder 400](onedrive-approot-create-folder-400-6427.md)
- [#7503 Kavita KOSync zero-based percentage](kavita-kosync-zero-based-percentage-7503.md) MERGED #7513
- [#5980/#6051 KOSync opened the wrong chapter](kosync-percentage-reanchor-impossible-path-5980.md) REGRESSION from #5111 · [xcfi emoji offsets + non-linear spine](xcfi-astral-offsets-nonlinear-spine.md)
- [Data Flow: descriptive source/sink connectors](data-flow-hub-source-sink.md) NOT a coordinator; unpushed
- [#7186 koplugin "logged out daily" + QR sign-in](koplugin-login-label-qr-signin-7186.md)
- [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED
- [koplugin pushes fail on slow TLS + open race](koplugin-slow-tls-push-and-open-race.md) UNFIXED · [Kobo BookDrop "no free port" every launch](koplugin-bookdrop-kobo-free-port.md)
- [#7504 OneDrive 401 on Android](onedrive-401-android-7504.md) NOT reproduced
- Resolved/stable → [Sync Fixes](sync-fixes.md)

## Infra Cost
- [Cloudflare cost breakdown 2026-11](private-cloudflare-cost-breakdown-2026-11.md) · [Supabase host drain 2026-11](private-supabase-host-drain-2026-11.md)

## Build, Testing & CI
- [Next 16.4 enables Turbopack build cache](next-16-4-turbopack-build-cache-default.md) · [macOS narration gap capture](macos-narration-audio-capture-recipe.md)
- [Leaf5C adb handwriting demo](leaf5c-adb-handwriting-demo.md) · [Ink sync reply drops strokes](ink-sync-reply-drops-strokes.md) · [Handwriting/drawing #6674](handwriting-ink-6674.md) MERGED · [BOOX pen SDK build gotchas](boox-pen-sdk-build-gotchas.md)
- [Sim build when no runtime matches the SDK](ios-sim-build-without-matching-runtime.md)
- [iOS 16 layout repro: Playwright 1.33 WebKit](ios16-safari-layout-repro-old-webkit.md) · [Drive the iOS sim WebView via iwdp](ios-sim-webview-drive-via-iwdp.md) · [iOS ad hoc build via ASC API](private-ios-ad-hoc-build-via-asc-api.md)
- [iOS sim PWA via hand-made web clip + XCUITest tap driver](ios-sim-pwa-webclip-cli-recipe.md) no computer use needed
- [iOS device build from a worktree](ios-worktree-device-build-gotchas.md) · [iOS device screenshots + dev-ios install](ios-device-screenshot-and-install-recipe.md)
- [KOReader push needs a matching plugin](koreader-push-needs-matching-plugin.md) · [Kindle KOReader e2e gotchas](koreader-kindle-e2e-gotchas.md) · [macOS deep-link test recipe](macos-deeplink-test-recipe.md)
- [Ad-hoc visual checks need theme tokens](adhoc-visual-check-daisyui-theme-tokens.md) · [worktree:new PR = rebased branch](worktree-new-pr-rebases-onto-main.md)
- [Merging main in a worktree leaves foliate on the old pin](worktree-merge-leaves-foliate-on-old-pin.md) check submodule status before checks
- [Nix FOD hash staleness](nix-fod-hash-staleness.md) · [No CI run after a conflicted PR push](pr-checks-not-triggered-after-conflict.md) · [Workflow-file pushes need SSH](push-workflow-file-needs-ssh-not-gh-oauth.md) · [Push dies after pre-push tests: push over HTTPS](push-ssh-drops-during-pre-push-hook.md)
- [KOSync repro on dev-web: mock server](kosync-dev-web-mock-server-recipe.md) · [Drive the macOS tauri dev window](desktop-dev-window-webdriver-recipe.md)
- [OPDS auto-download repro on dev-web](opds-autodownload-dev-web-recipe.md)
- [Drive RSVP on dev-web with Playwright](rsvp-playwright-dev-web-recipe.md)
- [openFixtureBook imports into the Xiaomi library](android-openfixturebook-imports-to-library.md) not on the owner's phone; transient-open recipe
- [E0463 tauri_macros on Xcode 27.1](rust-objcopy-misaligned-dylib-xcode27.md) rustup update stable
- [zip Dependabot alerts need tauri fork ≥ 2.12](zip-alerts-blocked-on-tauri-fork-2-12.md)
- [Plugin args pass through Rust models.rs](plugin-args-pass-through-rust-models.md) serde drops undeclared fields
- [CI-only flaky browser test: inject a foliate delay](ci-only-race-repro-inject-delay.md)
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md)

## Platform Compat
- [#6383 custom data location transfers forbidden](custom-data-location-transfer-forbidden-6383.md) REGRESSION from #6343 · [#6488 backups dropped reading stats](backup-reading-stats-6488.md) · [#6144 0.12.8 Linux launch failures](arch-cef-package-launch-crash-6144.md)
- Resolved/stable → [Platform Compat](platform-compat-fixes.md)

## Reader Features & UI
- [#7471 Dynamic Island blank: hidden home indicator or status bar](dynamic-island-home-indicator-7471.md) MERGED #7717
- [#7887 iOS web app top-edge blur: needs an opaque fixed/sticky box](ios-web-app-top-edge-blur-7887.md) MERGED #7888; /user + /hardcover unchecked
- [iPhone Duo series + #7146 orientation lock](iphone-duo-6307-column-gap.md) MERGED · [#6848 macOS paired M4B silent](macos-paired-audiobook-asset-range-cap-6848.md) next MAS build · [#6989 iOS narration in place](narration-ios-file-window-6989.md) MERGED
- [Android lookup app reset: vivo vs stock](android-lookup-app-reset-vivo.md)
- [Book li margins: keep like calibre](list-item-end-margin-bullets.md) owner rule
- [#6637 iOS OPDS http covers blocked](opds-http-cover-mixed-content-6637.md) · [primaryLanguage legacy raw values](book-primarylanguage-legacy-raw-values.md)
- [EPUB meta-cover href picked wrong cover](epub-meta-cover-href.md) · [Reading widget E-ink black-on-dark](reading-widget-eink-dark-mode.md) · [#5233 sentence-by-sentence + A-B repeat](tts-sentence-step-ab-repeat-5233.md) PR #6627 OPEN
- [#6618 dictionary text unreadable in dark](dict-dark-mode-text-colors-6618.md) · [#6347 series index cover badge](series-index-badge-6347.md) · [#6607 Plans page dropped the book](plans-page-back-to-reader-6607.md)
- [Apple on-device LLM](private-apple-on-device-llm-7429.md) #7429 open for macOS · [#5544 AI context dictionary](context-dictionary-5544.md) · [#6574 image long-press menu](image-long-press-menu-6574.md)
- [#6400 inverted image blank on Android](invert-image-blank-android-6400.md) · [#6568 iOS annotation cards expand on scroll](ios-touchstart-hover-annotation-expand-6568.md) · [Calibre plugin columns never filterable](calibre-plugin-custom-columns-filter.md)
- [#6433/#6457 media keys + desktop Now Playing](desktop-now-playing-6457.md) · [#6360 BookDrop own section](bookdrop-own-section-6360.md)
- [#6444 CarPlay no resume after nav prompt](carplay-interruption-resume-6444.md) · [#7168 CarPlay hidden app stops car music](carplay-hidden-app-music-stops-7168.md) NOT reproduced
- [#7566 CarPlay pick waited for unlock](carplay-locked-cold-start-7566.md) MERGED #7646, sim only
- [Older open reader issues](reader-open-issues.md) #5887 #5646 #5785 #1582…
- [#5795 per-device CSS](eink-per-device-css-data-eink-5795.md) Boox verify PENDING · [#5667 highlight invisible dark](eink-highlight-difference-mask-5667.md)
- [Reader overlay z-layers](annotator-overlay-z-layers.md) · [#6048 reading ruler on e-ink](reading-ruler-eink-6048.md) PR #6055 UNVERIFIED
- [#6107 two-column curl hinged at the spine](two-column-spine-curl-6107.md) REVIEWED not merged · [Readest Voice TTS](selfhosted-premium-tts-plans.md) v2 PROPOSED
- [Character tracking direction](character-tracking-direction.md) #6690 CLOSED
- [#7575 Auto Scroll page wipe: DOM copy](auto-scroll-page-wipe-7575.md) MERGED #7869
- [#7658 settings select: native + main's exact look](settings-select-native-same-look-7658.md) pixel snapshots vs main
- [Word Lens hint change left highlights misaligned](wordlens-gloss-highlight-redraw.md) MERGED #7616
- [#789/#6613 Vocabulary builder + Word Lens](vocabulary-builder-789-6613.md) PR #7284 OPEN · [Vocabulary ↔ AnkiDroid Sync (#789)](anki-link-ankidroid-789.md) MERGED; desktop AnkiConnect next
- [Sanitizer unwraps <rb>; rb ruby repros need Allow JavaScript](sanitizer-strips-rb-ruby.md) MERGED #7405
- [Chromium Selection.modify boundary quirks](chromium-selection-modify-boundary-quirks.md) · [open-book-in-reader skips guarded close](open-book-in-reader-skips-guarded-close.md) UNFIXED
- [#7692 read-aloud quieter than preview: Web Audio output path](android-tts-webaudio-output-path-7692.md)
- [#7621 stale narration load took over the clock after a skip](narration-stale-load-7621.md) MERGED #7627
- [#7364 narration staging OOM via Android JSON IPC](narration-stage-ipc-oom-7364.md) MERGED · [#7360 E-Ink two-book fix unlanded](eink-all-open-books-unlanded.md) unpushed
- [#6792 single-section chapter pull](single-section-chapter-pull-6792.md) MERGED #7422
- [#7635 rapid push swipes: touch takeover](push-turn-touch-takeover-7635.md) MERGED
- [#7599 scrolled-mode zoom kept the offset, not the text](scrolled-zoom-keeps-offset-7599.md) MERGED
- [RTL books already follow dc:language; UI RTL menu-only](rtl-book-direction-from-language.md)
- [#6676 cover split across columns in WebKit only](lone-image-page-webkit-split-6676.md) MERGED #7794 #7804 #7828
- [WebKit SVG filters resolve in the same document only](webkit-svg-filter-same-document-only.md) MERGED #7724
- [#7553 macOS file URL encodes ; as %3B](macos-file-url-semicolon-encoding-7553.md) MERGED #7554
- [#7482 highlight from paragraph start: CFI start between children](cfi-range-start-between-children-7482.md) MERGED; readest pins off-main foliate
- [#7537 footnote check rejects rich <sup> notes + orphan popup](footnote-check-superscript-7537.md) MERGED #7541
- [#7564 FB2→EPUB span-wrapped notes jumped to notes page](footnote-fb2-span-notes-7564.md) MERGED; worktree foliate origin is the local mirror
- [#7567 login page reopened by Android back](auth-back-history-stack-7567.md) MERGED #7568
- Resolved/stable → [Reader Feature Fixes](reader-feature-fixes.md)

## Library Fixes
- [#6662 page count at import + Pages sort](import-page-count-6662.md) MERGED
- [#5955 not all books auto-imported](autoimport-skips-deleted-books-5955.md) NOT reproducible · [#6703 re-key tombstone, last import wins](rekey-tombstone-last-import-wins-6703.md) MERGED
- [#6104 bookshelf clicks reopened the URL-launched book](deeplink-coldstart-hijacks-spawned-windows-6104.md) · [#5650 CDN 52x retry + metadata backfill](novel-import-transient-fetch-metadata-5650.md) MERGED

## Networking & LAN
- [CrossPoint <-> Readest plugin](crosspoint-integration-feasibility-2026-09.md) MERGED · [LocalSend integration](localsend-integration.md) MERGED · [Readest connector in crosspoint-sync](crosspoint-sync-readest-connector.md) DEFERRED
- [CrossPoint 2.0 clippings ↔ highlights](crosspoint-2-clippings-highlights.md) MERGED · [Notes sync loop on client/server skew](notes-sync-crosspoint-skew-loop.md) MERGED; deploy web before native

## Architecture & Patterns
- [Architecture notes](architecture-notes.md) · [Readest on Kindle feasibility](readest-on-kindle-feasibility.md)

## Workflow & Feedback
- [IAP Family Sharing state](iap-family-sharing-state.md) · [Dialog swallows keydown: use onKeyDownCapture](dialog-keydown-capture-phase.md) · [dev-web stats pull fails on local R2](dev-web-stats-pull-local-r2.md)
- [Annotations hub verify needs 60+ notes](verify-annotations-hub-needs-long-list.md) · [Reader chrome changes need e2e](verify-reader-chrome-needs-e2e.md) · [#6417 koplugin sync response files pile up](koplugin-stale-sync-responses-6417.md)
- [Native curl capture timing 2026-10-25](native-curl-capture-timing-2026-10-25.md) Page Flip MERGED #7160
