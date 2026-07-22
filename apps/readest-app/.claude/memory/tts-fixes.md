# TTS (Text-to-Speech) Fixes Reference

## Architecture

### Key Components
- `TTSController` (`src/services/tts/TTSController.ts`) - Core state machine
- `EdgeTTSClient` (`src/services/tts/EdgeTTSClient.ts`) - Edge TTS provider
- `useTTSControl` hook (`src/app/reader/hooks/useTTSControl.ts`) - React integration
- `useTTSMediaSession` hook (`src/app/reader/hooks/useTTSMediaSession.ts`) - Media controls

### Section-Aware TTS Model
TTS tracks its own section independently from the view via `#ttsSectionIndex`:
- `#initTTSForSection()` - Creates TTS document for a section without changing the view
- `#initTTSForNextSection()` / `#initTTSForPrevSection()` - Navigate TTS across sections
- `#getHighlighter()` - Only returns highlighter if view section matches TTS section
- `onSectionChange` callback - Notifies UI when TTS crosses section boundary
- Highlights use CFI strings (not raw Range objects) for cross-section compatibility

### State Management Pitfalls
1. **`#ttsSectionIndex` must match view section for highlights to work**
   - If `-1`, all highlight calls are suppressed
   - `shutdown()` sets it to `-1` but must also null out `this.view.tts`

2. **Guards/Refs that block re-entry:**
   - The old `ttsOnRef` guard blocked TTS restart from annotations (removed in #3292)
   - `view.tts` reference surviving shutdown blocked re-initialization (#3400)

3. **Timeouts that fire after pause:**
   - Edge TTS had a safety timeout that advanced sentences even when paused (#3244)
   - Solution: removed the entire `ontimeupdate` safety timeout mechanism

## Fix History

| Issue | Problem | Root Cause | Fix |
|-------|---------|------------|-----|
| #3100 | TTS scrolls too far | TTS coupled to view section | Added `#ttsSectionIndex`, "Back to TTS Location" button |
| #3198 | TTS doesn't follow to next section | No `onSectionChange` callback | Added section change notification, extracted hooks |
| #3244 | Paused TTS advances | Safety timeout fires after pause | Removed `ontimeupdate` timeout mechanism |
| #3291 | TTS fails without lang attribute | Invalid SSML from missing lang | Set lang/xml:lang on html element from `ttsLang` |
| #3292 | Can't restart TTS from annotation | `ttsOnRef` blocks re-entry | Removed the guard ref entirely |
| #3400 | TTS highlight stops after restart | `view.tts` not nulled on shutdown | Added `this.view.tts = null` in `shutdown()` |
| #4033 | Voice count flip-flops within one book (17↔5) | All 3 clients filtered voices by full locale (`v.lang.startsWith(locale)`); panel lang refreshes from the speaking mark (`getSpeakingLang`), and books mix region variants — Standard Ebooks boilerplate is `en-US` (17 Edge voices), body `en-GB` (5 Edge voices) | PR #4565: filter by primary lang (`isSameLang`) in Edge/Web/Native `getVoices`; new `TTSUtils.sortVoicesPreferLocaleFunc(locale)` keeps exact-locale voices first so `getVoiceIdFromLang` default stays region-aware. Also fixed `zh-Hans` → empty Edge list |

## Memory Index (moved from MEMORY.md 2026-07-19)

- [Android Auto TTS #3919/PR#4907](android-auto-tts-3919.md) MERGED · [CarPlay TTS](carplay-tts-support.md) device crash = tao UAF → `packages/tao`
- [iOS TTS native media session](ios-tts-media-session-native.md) PR#5085; pause-card killer = volume-key .mixWithOthers
- [TTS architecture refactor](tts-architecture-refactor-plan.md) SHIPPED #5126: SpeechProvider + SQLite cache
- [Edge TTS Web Audio engine (#3851)](edge-tts-webaudio-engine.md) gapless WebAudioPlayer + WSOLA
- [Background TTS sessions PR#4941](tts-background-session-decoupling.md) hash-keyed
- [#5032 TTS mini player stacking](tts-miniplayer-position-stacking.md)
- [TTS player redesign](tts-player-redesign.md) MERGED #4996; open: isPlaying glyph desync at section transitions
- [TTS player refinements PR#5162](tts-speed-ruler-5157.md) MERGED; TickRuler for speed+pauses, scrubber preview, mini player redesign (#5101); ttsPlayerStyle full/minimal
- [Android bg TTS media session fix](android-bg-tts-media-session-fix.md) in-process calls
- [Edge TTS https proxy is web-only](edge-tts-https-proxy-web-only.md) Tauri never hits /api/tts/edge; gate `!isTauriAppPlatform()`
- Native TTS: [#4676 iOS](native-ios-tts-4676.md) pause==stop; [#4613 offline halt](native-tts-offline-autoadvance-4613.md); [#4408 screen-lock](native-tts-screenlock-keepalive-4408.md) keep-alive tone
- Edge TTS: [word highlight #4017](edge-tts-word-highlighting-4017.md); [drift](tts-word-highlight-singletextnode-drift.md)
- TTS UX: [highlight granularity](tts-highlight-granularity-setting.md); [start-from-selection](tts-start-from-selection.md); [reuse session](tts-reuse-session-mode-entry.md)
- Tests: [browser e2e harness](tts-browser-e2e-harness.md); [paragraph+RSVP sync #3235](tts-sync-paragraph-rsvp-3235.md) TTS-is-clock; [teardown microtask flake #5151](tts-test-teardown-microtask-flake.md) stop speak loops in afterEach

## Debugging TTS Issues

1. **TTS doesn't start:** Check `#initTTSForSection()` - does `view.tts.doc === doc` shortcut early?
2. **No highlights:** Check `#ttsSectionIndex` matches view's section index
3. **Advances when paused:** Look for setTimeout/timer callbacks that bypass pause state
4. **Can't restart:** Check for refs/guards that prevent re-entry into speak handlers
5. **Fails on some chapters:** Check if chapter has lang attribute and XHTML namespace
6. **SSML errors:** Check `src/utils/ssml.ts` for proper namespace/lang handling
