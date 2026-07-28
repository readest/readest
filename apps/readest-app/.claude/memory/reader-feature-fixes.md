---
name: reader-feature-fixes
description: "Aggregator index for resolved/stable reader-feature memories (PDF viewer, selection, dict, toolbar, RSVP, widgets, misc UI)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4af4f927-b772-4650-bb93-26ccd73ba1cb
  modified: 2026-07-28T14:48:25.479Z
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
