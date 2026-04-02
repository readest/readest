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

## Debugging TTS Issues

1. **TTS doesn't start:** Check `#initTTSForSection()` - does `view.tts.doc === doc` shortcut early?
2. **No highlights:** Check `#ttsSectionIndex` matches view's section index
3. **Advances when paused:** Look for setTimeout/timer callbacks that bypass pause state
4. **Can't restart:** Check for refs/guards that prevent re-entry into speak handlers
5. **Fails on some chapters:** Check if chapter has lang attribute and XHTML namespace
6. **SSML errors:** Check `src/utils/ssml.ts` for proper namespace/lang handling
