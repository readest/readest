# Readest Project Memory

Index only — one line per memory. Detail lives in the topic files; do not restate it here.

## Key Reference Documents (aggregators)
- [Bug Patterns](bug-patterns.md) · [CSS & Style](css-style-fixes.md) · [TTS](tts-fixes.md)
- [Layout & UI](layout-ui-fixes.md) · [Platform Compat](platform-compat-fixes.md) · [Annotator & Reader](annotator-reader-fixes.md)
- [Sync Fixes](sync-fixes.md) · [Reader Feature Fixes](reader-feature-fixes.md)
- [Paginator & Scroll Fixes](paginator-scroll-fixes.md) · [Build & CI Recipes](build-ci-recipes.md)

## Safety & Security
- [Supabase 521/522 outage 2026-08-31](supabase-outage-2026-08-31-compute-and-bloat.md) NOT the auth hook; compute starvation; upgrade FIXED; reclaim + pg_cron retention + Mgmt-API statement_timeout recipes inside
- [API route auth audit 2026-08](api-route-auth-audit-2026-08.md) PRIVATE; hardcover + opds forward caller creds with NO caller auth; google RTDN fails open; share token comment is false; pages/api NOT audited
- [Android launch crash: widget 1px cover](widget-thumbnail-degenerate-cover-crash.md) MERGED #5874; fatal every launch; MIUI install needs emulator
- [Stripe checkout 500 storage add-on](stripe-checkout-500-storage-purchase.md) root cause UNCONFIRMED; diagnostics MERGED #5896
- [Apple lost storage purchase](apple-iap-lost-storage-purchase-restore-verify.md) 2 buyers credited by hand; #5669 MERGED but UNRELEASED; recipe inside
- [0.12.1 App Review crash](appstore-review-crash-0121-aswebauth-anchor.md) UNFIXED; `presentationAnchor` nil-window
- [iOS <=16 fonts.ready WebContent crash](ios16-fonts-ready-webcontent-crash.md) MERGED #5654 + foliate#71; poll `fonts.status`
- [Google RTDN verify downgrade](google-rtdn-worker-verify-downgrade-incident.md) googleapis dead on workerd · [Play storage add-ons never consumed](google-iap-consume-storage-purchases.md) MERGED #5545
- [In-place delete wiped originals](in-place-delete-wiped-originals.md) never `fs.removeFile` on `external` · [#5084/#5265 "Delete locally" wiped Drive](gdrive-delete-locally-wiped-cloud-5084.md) MERGED #5376
- [#5876 empty-library data location](migrate-data-empty-library-scan-guard-5876.md) MERGED #5878; fix = `dirScanned` flag
- [#4703 backup zip Win paths](backup-windows-zip-paths-4703.md) · [#4639 download_file scope](download-file-scope-android-regression.md)
- [#5147 Drive "Untitled" root files](gdrive-untitled-root-files-5147.md) · [Security advisories 2026-06](security-advisories-web-2026-06.md)
- [#5118 iOS PDF WebContent OOM](pdf-ios-webcontent-oom-zoom-5118.md) clamp renderDpr · [#5251 blurry desktop](pdf-blurry-desktop-dpr-clamp-5251.md)

## Paginator & Scroll
- [#5808 rotate walks the page back](resize-anchor-drift-5808.md) MERGED foliate#82 + #5855; Xiaomi VERIFIED
- [#5179 layered-turn toolbar sync](pr-5179-layered-turn-toolbar-sync.md) MERGED; review defects UNFIXED
- Resolved/stable → [Paginator & Scroll Fixes](paginator-scroll-fixes.md)

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` EPUB CSS hub · `packages/foliate-js/paginator.js` · `src/services/tts/TTSController.ts`
- `src/hooks/useSafeAreaInsets.ts` · `src/app/reader/components/FoliateViewer.tsx` · `.../annotator/Annotator.tsx`

## Sync Notes
- [New import invisible on peers](books-sync-inflight-change-dropped.md) useBooksSync dropped in-flight changes; PR #5869; 2nd-device verify pending
- [#5859 Boox progress reset to page one](progress-loss-android-tauri-plugin-deadlock-5859.md) ROOT = OPDS re-import under a NEW book_hash; PR #5866
- [Books toggle doesn't gate OPDS uploads](sync-books-toggle-opds-upload-leak.md) gate MERGED #5759; provider-only residue UNFIXED
- [#5062 multi-provider sync](multi-provider-cloud-sync-5062.md) MERGED #5122; native verify pending
- [iCloud sync provider](icloud-sync-provider.md) SHIPPED #5532+#5537; Dev ID recommit due 2027-02
- [MAS blank window](mas-sandbox-blank-customrootdir.md) MERGED #5789; runtime verify PENDING; NO VERSION file
- [#5570 KOSync/BookOrbit custom headers](custom-headers-kosync-bookorbit-5570.md) MERGED; kosync proxy OPEN RELAY fix UNMERGED
- [#5742 Readest books missing from BookOrbit](bookorbit-unmatched-source-5742.md) MERGED #5860; VERIFIED 6/6; recipe inside
- [#5661 "Synced in an hour"](sync-clock-skew-lastsynced-5661.md) clamp MERGED #5674; epoch-skew LWW poisoning UNFIXED
- [#5675 font sync "Unknown error"](font-sync-download-unknown-error-5675.md) PR #5700; `Unknown error` collapse UNFIXED
- [#5716 reference page count never synced](reference-page-count-sync-5716.md) MERGED #5727; per-book viewSettings cross NEITHER backend
- [deleted_at OR cursor invariant](sync-deleted-at-cursor-invariant.md) load-bearing
- [#5911/#5912 groups + descriptions erased by row LWW](group-metadata-row-lww-clobber-5911-5912.md) MERGED #5921; server half DEAD until web deploy
- [#5923 storage search auto-fired mid-IME](storage-manager-search-button-5923.md) MERGED #5925; no browser verify (auth-gated)
- [#5910 reader menu ignored third-party sync](reader-menu-third-party-sync-status-5910.md) MERGED #5922 via shared useCloudSyncStatus
- [#6029 manual sync](kosync-manual-sync-6029.md) MERGED #6034 (9e316c7d7); **BookOrbit ONLY** (chrox rescope, KOSync untouched); autoSync on KosyncEngineConfig not KOSyncSettings; default ON; gate the CALLERS not pushProgress; pulls stay automatic; `detail.provider` addressing; increment-throttling half NOT built; live-server verify PENDING
- [#5900 file sync never converged](file-sync-converge-5900.md) MERGED #5905; RULE incremental sync = O(changed), never a whole dir read
- [#5883 file sync never moved the live reader](file-sync-live-view-progress-5883.md) MERGED #5886; debounce 15s→5s; never device-tested
- [#5839 Qiniu S3 auth on `()` keys](s3-key-rfc3986-wire-encoding-5839.md) MERGED #5849; Qiniu verify pending
- [#5846 Hardcover picks the wrong book](hardcover-link-book-5846.md) MERGED #5857; NOT verified live
- [#5818 KO highlight deletions lost to id-dedupe](koreader-highlight-deletion-dedupe-5818.md) MERGED #5853; bookmark deletions still stuck
- [#5980 KOSync opened Ch6 for a valid Ch5 XPointer](kosync-percentage-reanchor-impossible-path-5980.md) REGRESSION from #5111; MERGED #6014 (c81bd0bee) UNVERIFIED; removed the percentage-drift anchor entirely (chrox); spine index CALCULATED never estimated
- [koplugin local_present sweep](koplugin-local-present-sweep-noop.md) UNFIXED; fix = rm readest_library.sqlite3
- [#5838 koplugin auto sync Wi-Fi prompts](koplugin-auto-sync-no-wifi-bringup-5838.md) MERGED #5848; OP's turn_on shape not fixed by design
- [#5625 loadDocument parsererror fallback](loaddocument-xhtml-parsererror-5625.md) MERGED #5630 + foliate#70
- Resolved/stable → [Sync Fixes](sync-fixes.md)

## Build, Testing & CI
- [TypeScript 7 upgrade #5260](typescript-7-upgrade-5260.md) MERGED #5893; no tsserver/tsgo (lint = `tsc`); next 16.3.3; rootDir fix
- [Nix FOD hash staleness](nix-fod-hash-staleness.md) MERGED #5779; hash from the PR check's `got:` line, NEVER docker/OrbStack
- [git push needs the SOCKS proxy](git-push-socks-proxy.md) ssh ProxyCommand only; `--no-verify` + ServerAliveInterval
- [worktree:new REBASES a PR branch](worktree-new-rebases-pr-force-push.md) pushing to a fork from it = FORCE push; use the real head
- [Workflow-file pushes need SSH](push-workflow-file-needs-ssh-not-gh-oauth.md) gh OAuth lacks `workflow` scope
- [#5732 nix android AVD ABI on Apple Silicon](nix-android-avd-abi-5732.md) MERGED #5850; M-series verify pending
- [Store listings in fastlane](store-listings-fastlane-5573.md) MERGED #5573; readest-promotions NOT live
- Stable recipes → [Build & CI Recipes](build-ci-recipes.md)

## Platform Compat
- [iOS sync tauri::command = watchdog kill](ios-sync-command-run-mobile-plugin-deadlock.md) MERGED #5947; parks the MAIN thread; sim-VERIFIED, UNRELEASED
- [#5372/#2862 Play keeps All Files Access](play-all-files-access-restored-5372.md) MERGED #5378; NEXT submission fills the form
- [#5397 Photos save crash](ios-photos-add-usage-description-5397.md) MERGED #5405; device-verify pending
- [Android OAuth hangs on MS passkey page](android-oauth-passkey-no-credential-provider.md) wedges WebAuthn till reboot; NOT a CCT bug
- [APKs opened with Readest](android-intent-filter-pathpattern-needs-host.md) MERGED #5610; `pathPattern` DEAD without `android:host`
- [#5799 BT HID hotplug recreates activity](android-configchanges-navigation-recreate-5799.md) MERGED #5804; manifest regen reintroduces it
- [Xiaomi loses ALL network when locked](xiaomi-monoproxy-freezes-when-locked.md) MonoProxy VPN freezes; unlock FIRST
- Resolved/stable → [Platform Compat](platform-compat-fixes.md)

## Reader Features & UI
- [#5932 settings scope](settings-scope-menu-5933.md) MERGED #5933 as 1-file ⋮ relabel; banner declined; info/warning tints fail on EVERY theme
- [#5945 separate library/reader theme](library-reader-theme-scope-5945.md) MERGED #5948 (ad9e5c1b8); store themeMode/themeColor now DERIVED (setState silently ignored); getThemeCode = reader-only
- [daisyUI 5 + Tailwind 4 migration](daisyui-v5-tailwind-v4-migration.md) MERGED #5884; custom CSS MUST be `@layer utilities`; 4 regressions fixed; bracket-stripping `p-[Npx]`->`p-Npx` emits NO CSS; compile-check recipe inside
- [#480 IDPF EPUB3 sample sweep](epub3-samples-idpf-480.md) MERGED #5872 + foliate#84; 42 samples Chrome-verified
- [#1812 Kotobee EPUB embedded video](epub-embedded-video-kotobee-1812.md) MERGED #5868 + foliate#83; blob: base resolution; ALWAYS re-pin foliate
- [#6018 MDD dict audio/POS/image + `&apos;` name](mdict-audio-pos-image-6018.md) MERGED #6021 (211cb2b67); ALL 3 ANDROID-VERIFIED (OALD9 `house`); iOS audio typeless blob + play() after await; image zoom reuses ModalPortal+ImageViewer, take the hidden ox-enlarge twin; `composedPath()` for shadow retarget
- [Lookup surfaces flashed shut on mobile](lookup-surface-flash-suppress-handles-6013.md) MERGED #6022 (7413386ce); REGRESSION from #6013; suppressNativeSelectionHandles republished the selection -> toolbar closed the sheet; fix = early-return while any lookup surface is up
- Footnote popup: [#5999/#5998 double scrollbar + jump](footnote-popup-double-scrollbar-5999-5998.md) MERGED #6006; popup sizes are CONTENT, Popup takes BORDER box (+2*border) · [#5887 size](footnote-popup-content-size-5887.md) OPEN · [#5766 jump](footnote-popup-jump-to-location-5766.md) · [blob revoke](footnote-popup-revokes-section-blobs.md) · [#5646 selection](footnote-popup-selection-5646.md) OPEN · [#5780 edit](pr-5780-inline-note-popup-edit-review.md) · [#5785 markdown](note-popup-markdown-5785.md) OPEN
- Translation: [#1582 markup lost](translation-inline-markup-1582.md) OPEN, deepl CORRUPTS · [en→zh providers](translation-providers-device-verification-2026-08.md) #5913 · [#5772 iframe observer](translation-iframe-observer-5772.md) INDEX-COUPLED · [#5600 PDF quota toast](pdf-translation-quota-toast-5600.md) OPEN
- TTS: [#5755 lyric view](tts-lyric-view-5755.md) #5908+#5909 · [#5690 download queue](tts-download-queue-5690.md) · [#5750 pause](tts-pause-inconsistency-5750.md) · [#5414 Edge silence iOS](edge-tts-baked-silence-ios-native-5414.md) · [#5230 Edge stall](edge-tts-tauri-ws-hang-5230.md) · [word highlight vs ruby](tts-word-highlight-wordlens-ruby-collapse.md)
- Narration: [#5480 Media Overlays](media-overlay-narration-5480.md) UNFIXED · [#5562 iOS AVPlayer](media-overlay-ios-native-playout-5562.md) · [Audiobookshelf 1+2](audiobookshelf-integration-phase1.md) · [#5863 transport+WebP](abs-audio-transport-5863.md) · [#5807 read-along](abs-read-along-5807.md)
- e-ink: [`[class*=]` matchers](eink-class-substring-matchers.md) fire on variants, beat inline styles · [#5795 per-device CSS](eink-per-device-css-data-eink-5795.md) Boox verify PENDING · [#5667 highlight invisible dark](eink-highlight-difference-mask-5667.md) transientHighlight UNFIXED
- CSS/layout: [#5711 fixed-attachment](css-fixed-attachment-negative-margin-5711.md) OPEN · [#5641 FXL autosizing](fxl-chrome-android-text-autosizing-5641.md) · [#5582 SE word gaps](se-text-wrap-pretty-justify-5582.md) · [#5662 Alert sizing](alert-flex-item-content-sizing-5662.md) w-full · [#5852 TOC headings](toc-multiline-headings-5852.md) min-w-0
- Rendering: [#5924 RTL blank pages](rtl-skip-link-blank-pages-5924.md) · [#5918 AZW3 garbled](azw3-loadraw-concurrency-5918.md) loadRaw races · [#5745 CBZ order](cbz-split-folder-page-order-5745.md) · [#5822 PDF page labels](pdf-page-labels-reference-pages-5822.md) · [#5635 Auto Scroll frozen](autoscroll-progress-relocate-maxwait-5635.md) OPEN
- [Reader overlay z-layers](annotator-overlay-z-layers.md) selection toolbar z-[43] < handles z-[44] < z-[45] panels < z-50 popups/dialogs; the toolbar is the ONE surface that must sit BELOW the handles (it opens on the selection, so it overlapped and swallowed the end handle after #6013) and that broke the Android E2E lane (MERGED #6036, 88ea2de55); the `div.cursor-grab` helper query also counted #6031 highlight strip; iOS native grabbers are UIKit ABOVE the web layer, UNSTACKABLE; suppressNativeSelectionHandles() removes them without spending the selection; iOS verify PENDING
- [#5987/#5957 new annotations invisible after Annotate](annotations-hub-scroll-to-new-note-5987-5957.md) MERGED #6013 (6df90139d); fix = editor moved ONTO the selection (popup + snapHeight 0.6 sheet) NOT hub scrolling; Insert-into-Notebook REMOVED; chrox: ALWAYS sort by CFI
- [#5983 one-tap highlighting](one-tap-highlight-5983.md) MERGED #6031 (87bba1369); strip shows on selection when highlight tool on toolbar; popup-no-CFI keeps plain bar; e2e popupTool needed exact aria-label match (strip button answers substring "Highlight"); CDP pointer events never reach iframe listeners, dispatch synthetic PointerEvents
- [#5976 lock horizontal panning](pdf-lock-horizontal-pan-5976.md) MERGED #6030 (63fb3230e) + foliate-js #89 (b1fe9d3); THREE layers, and `touch-action` alone is a NO-OP because pdf.js pans by writing `scrollLeft` in JS; snapshot scrollLeft in `#showSpread` before the frame swap clamps it; Xiaomi-VERIFIED incl. pinch + reload; CDP: reveal the opacity-0 header first, menus need MOUSE events
- [#5939 edge gestures vs mid-touch selection](edge-gesture-selection-after-touchstart-5939.md) MERGED #5958; re-check selection EVERY move + `scrollLocked`; autoscroll-speed twin UNFIXED
- [#5979 Steam Deck gamepad double inputs](gamepad-support-toggle-5979.md) MERGED #6027 (b12932da9) UNVERIFIED on a Deck; toggle ONLY, remapping skipped; gate MUST sit in ReaderContent (only consumer of BOTH gamepad hooks) and read the STORE not the `settings` prop
- Reader chrome: [#5938 header/footer style](header-footer-style-5938.md) MERGED #5960 · [#5652/#5634 header vs footer](reader-header-footer-dedup-5652-5634.md) · [#4977 top bar blocks selection](header-trigger-overlaps-text-4977.md) · [#5888 cross-page selection](cross-page-selection-edge-turn-5888.md) · [#3772 custom shortcuts](custom-shortcuts-3772.md) · [#5501 Apple Pencil](apple-pencil-page-turner-5501.md)
- Annotator: [#5538 resize orphan bubble](highlight-resize-orphan-note-bubble-5538.md) drag-race UNFIXED · [#5585 Instant Dictionary](instant-dictionary-deselect-5585.md) clear isTextSelected FIRST · [Proofread gate](proofread-gate-reflowable-formats.md) born dead
- Images/PDF: [#5633 iOS zoom blurry](ios-imageviewer-zoom-blur-5633.md) TableViewer UNFIXED · [#5250 invert img](invert-img-dark-override-5250.md) PR #5383 · [#5813 cover full screen](book-cover-fullscreen-viewer-5813.md) · [#5776 title/series attrs](book-meta-data-attrs-5776.md)
- Word Lens: [en-hu pack](wordlens-en-hu-pack-5738.md) `pnpm wordlens:sync` is MANUAL · [kaikki raw dump](wordlens-en-vi-pack-5737.md) per-language file DEPRECATED · [Readest Voice TTS](selfhosted-premium-tts-plans.md) approved, not started
- [#6003 calibre OPDS pubdate](opds-calibre-pubdate-vs-date-added-6003.md) fix = foliate-js#88 MERGED (799ab10) + readest#6008 OPEN; foliate-js#10 flipped atom:published above dc:date; #5477 made it CORRUPT the library; calibre vs Calibre-Web mean OPPOSITE by atom:published
- [#5982 import from ReadEra](readera-import-5982.md) MERGED #6032 (8b8fbe14d) UNVERIFIED on device; ReadEra doc_md5 = FULL-file md5, matched when titles decide nothing; per-book dialog row; the export is `.bak` (a plain zip), NO book files (match by title/author); ReadEra XPointers carry an EXTRA `body` (`/body/DocFragment[N]/body/body/...`) that MUST be stripped; anchor = text search -> XPointer -> section start; page-only locators map to a section ONLY on paged books
- OPDS/koplugin: [OPDS fixes](opds-fixes.md) aggregator · [#5583 format filter](opds-download-format-filter-5583.md) PR #5593 · [#5645 self-update crash](koplugin-selfupdate-unpackarchive-5645.md) unpackArchive DROPPED upstream
- Known-unfixed: [#4584 tap-death](issue-4584-tap-death-investigation.md) WebView-148 · [#5353 italic clipped](italic-synthetic-oblique-clip-5353.md) · [#5749 iOS hyphenation](hyphenation-engines-5749.md) WebKit dict SEALED · [virtuoso first-paint blank](mobile-sheet-virtuoso-first-paint-blank.md)
- [PR #5389 library full-text search review](pr-5389-library-search-review.md) plan in .agents/plans
- Resolved/stable → [Reader Feature Fixes](reader-feature-fixes.md)

- [Storage vs customization entitlement split](storage-customization-entitlement-split.md) MERGED #5996 DEPLOYED; Stripe SKU LIVE $19.99 sells sync/TTS/email-in NOT themes+fonts; PREMIUM_PLANS excludes purchase BY DESIGN; grandfather = synthetic payments row; SELF_HOSTED unlocks all
- [Move a storage purchase between accounts](storage-purchase-account-transfer.md) reassign the store row + a synthetic audit row on the loser; `scripts/db/transfer-storage-purchase.mjs`
- [Yearly subscriptions + plans grid](yearly-subscriptions-store-front.md) MERGED #5989; Stripe yearly prices on EXISTING Plus/Pro products (getSubscriptionPlan reads product.metadata.plan); App Store/Play yearly SKUs NOT created; prices.list needs limit:100 + month-before-year
- [#1750 Notion sync](notion-sync-pr-5949-review.md) MERGED #5949 as 295d6e79; 4 defects SHIPPED UNFIXED, worst DELETES the user's own Notion blocks (remoteNoteGroups slice); needs a follow-up issue

## Library Fixes
- [#5955 not all books auto-imported](autoimport-skips-deleted-books-5955.md) NOT reproducible; watcher silently skips DELETED books' paths forever (tombstone + altFilePaths)
- [#5959 updated EPUB imports as a duplicate](duplicate-book-calibre-uuid-5959.md) MERGED #5961 (053aba67f) UNVERIFIED on device; metaHash is a WIRE KEY (server + koplugin meta_hash_v1), never change its output
- [#5935 group by reading status](status-grouping-i18n-5935.md) MERGED 82658d8ed; grouping MUST partition (414/750 fell out, Unread held 1); `BooksGroup.localized` gates `_()`; fork push = NEVER the worktree:new head
- [#5148 no overscroll on mobile = LIBRARY grid](overscroll-library-not-reader-5148.md) MERGED #5867; NEVER for foliate view; goToFraction(1) marks FINISHED
- [#5775 in-app web browser as book source](in-app-browser-book-source-5775.md) MERGED #5870; iOS flow never verified; target=_blank bug OPEN
- [Windows clip/browser window 0x8007139F](webview2-env-options-scrollbar-clip-window.md) MERGED #5873; every extra WebviewWindow MUST set FluentOverlay
- [#5837 backup exports orphan book dirs](backup-orphan-book-files-5837.md) MERGED #5851; `readDirectory('', 'Books')` MISSES the Rust walk
- [#5650 CDN 52x retry + metadata backfill](novel-import-transient-fetch-metadata-5650.md) MERGED; chapter TRUNCATION UNFIXED
- [#5596 long-press select double-toggles](longpress-contextmenu-double-fire-5596.md) MERGED #5621
- [#5680 Read-in-place uncheck](readinplace-uncheck-unregister-5680.md) MERGED #5685; drag-drop must pass real registration state
- [#5360 Wayland tap kills native menu](wayland-tap-context-menu-5360.md) MERGED #5467

## Networking & LAN
- [Nearby BookDrop branding](nearby-bookdrop-branding.md) MERGED #5915; code ids stay `localsend`; ABS row not plural-aware
- [Nearby BookDrop v2 (AirDrop UI + pairing + sounds)](nearby-bookdrop-v2-pairing-airdrop-sounds.md) PR #6023 MERGED squash 5a3ab1b47 (feat/bookdrop-radar-pairing, rebased onto #6019); verified macOS+Xiaomi; pairing = TLS cert fingerprint, Customization-gated; sounds RECEIVER-ONLY placeholders; Phase 2 relay deferred; pass-4 unicast-reprobe keepalive; pass-5 CodeRabbit review handled (e09ec625e): heartbeat guards, impactFeedback rejection, ListenerFailed teardown+foreground restart (iOS-dormant), fa/nl/pl grammar
- [LocalSend integration](localsend-integration.md) MERGED #5611; fork `readest/localsend`; commands need 3-place ACL
- [koplugin LocalSend receive+send](koplugin-localsend-receive.md) MERGED #5687; static-musl binary; ANDROID exec IMPOSSIBLE · discovery was DEAD 3 ways, MERGED #5626 + fork rev 37219949 (rev bumps rebase BOTH patches)

## Architecture & Patterns
- [Tauri Channel progress lands AFTER invoke resolves](tauri-channel-progress-after-invoke-resolves.md) MERGED #5736; latch every onProgress pair
- foliate-js submodule `packages/foliate-js/`; multiview paginator preloads adjacent sections
- [.md support #774](markdown-md-support-774.md) resume #4862, footnotes #5074 · [#5279 YAML frontmatter](markdown-yaml-frontmatter-5279.md) MERGED #5344
- [md titled after first H1, not the file](markdown-title-first-h1-over-filename.md) PR #5653
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding; `transformStylesheet()` rewrites EPUB CSS
- TTS `#ttsSectionIndex`; insets: native plugin → useSafeAreaInsets → styles; Dropdowns `DropdownContext`
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) · [Theorem competitor analysis](theorem-competitor-feature-analysis.md)
- [Design system → DESIGN.md](feedback_design_system_doc.md) never `pl/pr/ml/mr` (RTL) · [swatch+select rows](settings-row-two-controls.md) SettingsSelect `max-w-[60%]` truncates in a wrapper

## Workflow & Feedback
- [/user-report skill](user-report-skill.md) report -> gh issue -> ~/Documents/books/issues/<id>/; Chrome downloads land on ~/Desktop
- [Always verify on Xiaomi](feedback-always-verify-on-xiaomi.md) device 368b0948; CDP+deep-link recipe; md5-check the APK
- [Slice-in-loop NOT O(n^2)](review-perf-slice-not-quadratic.md) V8 SlicedString
- [Commit messages English-only](feedback-commit-message-english-only.md) no CJK, no em/en dashes
- PR flow: [rebase onto origin/main](feedback_pr_rebase.md) · [fresh branch per PR](feedback_pr_new_branch.md) · [always `pnpm worktree:new`](feedback_use_worktree.md)
- [`pnpm lint` EXCLUDES the format check](verify-lint-excludes-format-check.md) run `pnpm format:check` too or CI `build_web_app` fails on formatting
- [Don't push till confirmed](feedback_dont_push_every_change.md) pre-push hook runs full vitest (~2.5 min)
- [Test file filter](feedback_test_file_filter.md) `pnpm test <path>` no `--` · [No test seams in prod](feedback_no_test_seams_in_prod.md) · [no lookbehind regex](feedback_no_lookbehind_regex.md)
- [No mock-only platform tests](feedback-no-mock-only-platform-tests.md) · [No config-mirror tests](feedback-no-config-mirror-tests.md) validate via `cargo check`
- i18n: [match the locale's established term](i18n-match-established-locale-terms.md) grep `Highlights`/`Notes` before inventing a synonym; audit case-folded + stemmed
- i18n: [en plurals manual](feedback_en_plurals_manual.md) · [i18n:extract prunes keys](i18n-extract-prunes-keys.md) · [label rename = key rename](i18n-label-rename-workflow.md)
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) `overrides:` · [deps security](deps-security-overrides-workflow.md) #5335+#5518 · [gstack upgrade](feedback_gstack_upgrade.md) project-local
- [Reserved route filenames under src/app/](nextjs-app-dir-reserved-route-filenames.md) `layout.ts` helper = route layout; build-only failure
- [Annotations hub verify needs 60+ notes](verify-annotations-hub-needs-long-list.md) `pnpm dev-web` dies silently on a busy port 3000; short lists give FALSE PASSES; seed config.json from /library, never with the book open
- [dev-web serves STALE locales](verify-dev-web-serwist-stale-locales.md) serwist `offline-cache` beats the dev server; new i18n keys render in English until you clear `caches`
- [Reader chrome changes need e2e](verify-reader-chrome-needs-e2e.md) `ReaderPage.ts` hard-codes toolbar aria-labels
- [stat_pages slow query + disk growth](stat-pages-slow-query-disk-growth.md) #5835+#5844 DEPLOYED; cron FLIPPED 3719ec648
- [No prod metrics in public issues/PRs](feedback-no-prod-metrics-in-public.md) #5834 DELETED for exposing prod data
- [KOReader emulator headless verify](koreader-emulator-headless-verify.md) HttpInspector recipe; never mv the stats DB
