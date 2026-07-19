---
name: tts-miniplayer-position-stacking
description: TTS mini player mounts immediately and stacks above bottom bar / footer band / 16px resting offset (issue 5032) MERGED PR 5144
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e4be60f-c98e-4061-a5e7-96b791b6da34
---

TTS mini player positioning (2026-07-16, issue #5032) MERGED #5144 (b6c994413): the card no longer fades out when the
bottom bar shows and no longer waits for TTS client init to mount.

- `src/app/reader/utils/ttsMiniPlayerPosition.ts` — `getTTSMiniPlayerBottomOffset(vs, {barVisible, usesMobileBar})`:
  bar visible → 72px (mobile, 64 bar + 8 gap) / 60px (desktop, 52 + 8);
  bar dismissed + footer info at bottom → `max(marginBottomPx, 16)` (flush with band top, scrolled pills included);
  otherwise 16px. Safe-area inset stays separate as `marginBottom: gridInsets.bottom * 0.33`.
- Mount gate in TTSControl is `showIndicator && !showPlayerSheet` (no more `ttsClientsInited`);
  `handleTTSSpeak` sets `setIsPlaying(true)` optimistically and the catch/no-ssml paths roll it back —
  without that rollback a failed start leaves a zombie mini player.
- FoliateViewer clearance = `getTTSMiniPlayerBottomOffset(vs) + TTS_MINI_PLAYER_HEIGHT (56) + inset*0.33`
  (replaced the old `TTS_MINI_PLAYER_CLEARANCE = 64` const) because the card now stacks ABOVE the
  footer band instead of covering it; the `moreBottomInset` max() formula is unchanged.
- Expand (`onExpand`) is ignored until `ttsClientsInited` — the sheet needs voices/timeline, and the
  sheet gate would otherwise hide both surfaces.

Follow-up (same PR): expanded mobile action panels (font/color/progress) stack too —
`bottomBarTab` lifted from FooterBar local state into readerStore; TTSMiniPlayer measures the
panel's settled top (`.footerbar-<tab>-mobile`, transform-corrected via DOMMatrixReadOnly) and
passes `panelTopOffset`; panels keep pt-8/pb-4 in BOTH states (slide is transform-only) so
offsetHeight is stable mid-animation. Horizontal insets inset-x-2 → inset-x-4 (16px).
Verified on Pixel_9_Pro AVD over CDP with real adb taps (72px/8px-gap nav bar; 240px/8px-gap
expanded panel; flush footer band; 16px insets).

Verified in Chrome (74ms click→mount; 60/44-flush/16px measured). Tests:
`src/__tests__/components/tts-mini-player-position.test.ts`, TTSMiniPlayer/TTSControl tests updated.

Related: [[tts-player-redesign]], [[tts-background-session-decoupling]]
