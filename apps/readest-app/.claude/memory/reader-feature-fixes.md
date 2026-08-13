---
name: reader-feature-fixes
description: "Aggregator index for resolved/stable reader-feature memories (PDF viewer, selection, dict, toolbar, RSVP, widgets, misc UI)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4af4f927-b772-4650-bb93-26ccd73ba1cb
  modified: 2026-08-06T03:23:22.515Z
---

Moved from MEMORY.md to keep the index small. One line per memory; open the linked file for detail.

- Widgets: [#1602 mobile reading](mobile-reading-widgets.md); [App Group breakage](ios-appstore-appgroup-carplay-provisioning.md) stale skip-worktree pbxproj; [cover edge line](ios-widget-cover-bright-edge-line.md)
- PDF: [#4795 lag](pdf-scroll-lag-preload-4795.md); [#4817 pinch](scrolled-pdf-pinch-zoom-4817.md); [#4858 pinch vs scroll](pinch-vs-twofinger-scroll-4858.md); [#4480 sel font scale](pdf-text-selection-fontscale-4480.md); [#5142 pan menu](pdf-swipe-pan-toggles-menu-5142.md)
- [#5043 sidebar resize over PDF](sidebar-resize-sticks-pdf-5043.md) MERGED #5198; FXL iframe PE:auto defeats body-PE-none; fix = shield overlay
- [Search modes #4560](search-modes-4560-and-spoiler-bound-bug.md)
- [OPDS groups carousel #4750](opds-groups-carousel-4750.md) · [WebDAV browse sort+search #4724](webdav-browse-sort-search-4724.md)
- [Image zoom trackpad flicker #4742](image-zoom-trackpad-flicker-4742.md) macOS pinch=`ctrl+wheel`
- Instant highlight: [ate tap/swipe](instant-highlight-tap-paginate.md); [#4773 orphan](instant-highlight-delete-orphan-4773.md); [#4791 empty leak](empty-highlight-leak-on-annotate-cancel-4791.md)
- Selection: [#4728 keyboard](keyboard-selection-adjust-4728.md); [#4741 cross-page](cross-page-selection-autoturn-4741.md); [iOS toolbar flash](ios-selection-toolbar-flash-defer.md) defer to touchend
- Click/tap: [dbl-click word select](iframe-double-click-word-select.md); [#4524 dblclick-drag](dblclick-drag-pageturn-4524.md); [#4600 tap open image](tap-to-open-image-table-4600.md)
- #5069 long-press zoom REMOVED
- Samsung save-to-gallery #5109 unconfirmed
- [Annotator onLoad leak #4735](annotator-onload-listener-leak-paragraph-mode.md)
- [PDF/CBZ Contrast view-menu](pdf-cbz-contrast-view-menu.md) ONE `filter:` · header/footer over light PDF (#4901) `mix-blend-difference`
- [iOS instant-dict double popup](ios-instant-dict-double-popup.md) once-per-gesture latch
- Dict: [#4443 popup font](dict-popup-font-size-4443.md); [#4574 lemmatization](dict-lemmatization-4574.md); [#4876 speak button](dict-popup-tts-speak-4876.md)
- Word Lens: [inline gloss](wordlens-feature.md) CFI-safe ruby; en-en
- [Stripe highest-active plan #4694](stripe-plan-highest-active-4694.md) · [Save image to gallery #4680](save-image-to-gallery-android.md)
- [Webtoon Mode #3647](webtoon-mode-3647.md) · [D-pad Navigation](dpad-navigation.md)
- [Middle-click autoscroll #4951](middle-click-autoscroll-4951.md) · [Auto Scroll teleprompter #4998](auto-scroll-teleprompter-4998.md) MERGED
- [Auto-scroll speed swipe #5206](auto-scroll-speed-swipe-5206.md) MERGED; mirrors left-edge brightness gesture; armed only in session
- [Biometric app-lock #4645](biometric-app-lock-4645.md) · [Reference Pages #4542](reference-pages-672-4542.md) · [e-ink refresh #4687](eink-screen-refresh-pageturner-4687.md)
- [Share intent + toolbar #4014](annotation-share-toolbar-4014.md)
- Toolbar: [serializeConfig #4760](customize-toolbar-global-serializeconfig.md); [e-ink black bar #4839](customize-toolbar-eink-black-bar-4839.md)
- RSVP: [control-bar REVERT](rsvp-control-bar-overlap-revert.md); [#4519 font](rsvp-font-settings-4519.md); [#4630 RTL](rsvp-rtl-word-display-4630.md)
- [Overlay z-index scale](zindex-overlay-scale.md) RSVP 100 → app-lock
- [Global annotation page-turn lag #4575](global-annotation-pageturn-perf-4575.md) · [Overlayer splitRange text nodes](overlayer-splitrange-textnodes.md)
- [Android image callout freeze](android-image-callout-freeze.md) `.no-context-menu` ANCESTOR
- Inline-img vertical-align (#4866) · [Table dark-mode tint #4419](table-dark-mode-tint-4419.md) · [footnote aside border #4438](footnote-aside-namespace-order-4438.md)
- [Russian NBSP #4769](russian-hanging-prepositions-nbsp-4769.md)
- [#5398/#3870 annotations hub](annotations-hub-5398-3870.md) MERGED #5448; shared filterBooknotes/facets; toolbar = icon row + filter dropdown (merge injected menuClassName); header search icon per-tab
- [#5406 TTS vs proofread doc sync](tts-proofread-doc-sync-5406.md) MERGED #5416; createDocument bypassed transformTarget 'data' transforms; TTS docs replay display pipeline; MD books get transformTarget + srcdoc path
- [#5262 clip sign-in capture](clip-signin-interactive-capture-5262.md) MERGED #5377; interactive clip mode + Safari share-ext DOM capture; xcodegen-in-worktree symlink trick
- [#5294 web-novel URL import](webnovel-url-import-5294.md) MERGED #5381; buildEpub not feed-book; re-import in place via metaHash, exact-URL-keyed; clip pickMetaContent dead code UNFIXED
- [#5352 Discord cover -> book icon](discord-cover-fallback-5352.md) MERGED #5382; content-addressed temp key; negative cache split missing vs transient; no Content-Type + no log still open
- [#5216 Persian RLM half-space](rlm-bidi-mark-shaping-5216.md) PR #5361 MERGED; sanitizer half dead code; real cause = font-fallback shaping
- [#5362 image zoom % was fit-relative](image-viewer-fit-relative-zoom-5362.md) MERGED #5365; `will-change` does NOT pin raster scale; dataUrl byte-exact
- Paragraph mode: [toggle/resume #4717](paragraph-mode-toggle-resume-4717.md); [exit #4474](paragraph-mode-accidental-exit-4474.md); [#5275 styling](paragraph-mode-styling-5275.md) MERGED #5338 solid backdrop or ghosting; [#5246 display settings](paragraph-mode-display-settings-5246.md) MERGED #5403 font on frame or 66ch won't scale
- [#5178 auto-hide cursor](autohide-cursor-5178.md) MERGED #5404; dormant foliate CursorAutohider; attr on view NOT renderer; top-level SystemSettings, default-on
- [#5342 footer pills go black](footer-pill-vs-blend-5342.md) MERGED #5347; pill bg and `mix-blend-difference` cannot coexist
- [#5351 popup restyle](popup-filter-containing-block-5351.md) MERGED; ancestor `filter` = containing block + stacking context; `theme-dark:` variant; `text-foreground` undefined token
- [#5303 header notch negative margin](header-notch-negative-margin-5303.md) MERGED #5447, VERIFIED Xiaomi 13; z-10 ONLY when lifted else covers desktop toolbar
- [#5394 Ambient Mode (light sensor)](ambient-mode-light-sensor-5394.md) MERGED; `emitOrQueue` one-shot-only; themeStore vs `getThemeCode` defaults must match
- [#5452 Copy Link annotation tool](annotation-toolbar-copylink-5452.md) MERGED #5464; opt-in = ALL_ minus DEFAULT_
- [#5232 image viewer alt caption](image-viewer-alt-caption-5232.md) MERGED #5472
- [#5293 tap-to-toggle progress bar](tap-toggle-progress-bar-5293.md) MERGED #5466; verify with trusted clicks
- [#4995 FXL horizontal scrolling](fxl-horizontal-scroll-4995.md) MERGED foliate#65+readest#5485; CDP scroll gestures CANNOT test it
- [FXL scrolled clipped at camera hole](fxl-scrolled-notch-mask-edge-to-edge.md) MERGED #5503; SectionInfo notch mask skips isFixedLayout; CDP elementsFromPoint + live classList.remove repro
- [#5270 OPDS feed cover+metadata](opds-feed-cover-5270.md) BOTH MERGED #5471+#5477; feed-wins per-field merge
- [#5492 stale OPDS cover after server update](opds-cover-updated-cache-5492.md) MERGED #5495; `<updated>` in cache keys
- [Paragraph-layout `:has()` allowlist trap](paragraph-layout-has-allowlist-trap.md) MERGED #5555; tell = lineHeight `normal` · [Translation CFI stability](translation-cfi-stability.md) MERGED #5555; hazard = blanking source nodes
- [#5516 Pages in Book Details](book-details-page-count-5516.md) MERGED #5523; live count in `bookData.config` · [#5499 Android autofill sign-in](android-signin-autofill-formdata-5499.md) MERGED #5505; FormData at submit
- [Hint band align + battery `invert`](hint-band-align-and-battery-invert-contrast.md) contrast = base-content, NEVER invert() · [Autohide cursor blanked mid-selection](cursor-autohide-blanked-during-selection.md) MERGED foliate-js#68 + #5557
- [#5584 title bar dead in OPDS view](titlebar-drag-needs-headerref-5584.md) MERGED #5592; drag is JS, every header MUST pass `headerRef` + exclude its inputs
- [Window title names the book](window-title-book-name-a11y-5547.md) MERGED #5547; macOS Overlay DRAWS the title; set-title ACL fixed #5578
- [Annotations toolbar count summary](annotations-toolbar-count-summary-5576.md) MERGED #5576 · [Highlight style buttons preview colors](highlight-style-buttons-preview-colors.md) MERGED #5578; resolve `customColors[c] || c`
- [#5496 popup chrome family](popup-chrome-family-5496.md) MERGED; `.popup-container` load-bearing for eink · [#5213 dictionary single-word gate](quick-action-dictionary-single-word-5213.md) MERGED #5529; 8-char CJK cap
- [Search history chips over textures](library-search-history-mask-fade-5488.md) MERGED #5488; fades = `mask-image` · [#5119 Then-by asc/desc](library-then-by-sort-order-5119.md) MERGED #5474; URL cleanup lies on deep links
- [#5259 dropdown viewport fix](dropdown-floating-ui-portal-5259.md) MERGED #5392; portals break TalkBack traversal
