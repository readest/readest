# Citadel Debug Helpers

Recommended future dev helpers for audiobook sync debugging.
**These are NOT implemented yet.** They describe the desired API surface.

---

## Browser Console Diagnostics

When the Tauri app is running with an audiobook-attached EPUB open, the following
globals would be exposed on `window.__citadelAudiobookSyncDiagnostics`:

### `dumpRuntime()`

Dump the full runtime state of the audiobook sync pipeline to the console:

```
> window.__citadelAudiobookSyncDiagnostics.dumpRuntime()
{
  bookKey: "abc123-hash",
  audioSrc: "file:///.../book.mp3",
  duration: 3600.5,
  currentTime: 124.3,
  isPlaying: true,
  isLoaded: true,
  syncStatus: "ready",
  syncMapSize: 247,
  lastAppliedEntry: { secondsStart: 122.1, cfi: "/6/4[...]", sectionIndex: 3 },
  activeView: { key: "abc123-hash", primaryIndex: 3, totalSections: 42 },
}
```

### `currentEntry()`

Return the sync map entry for the current playback time:

```
> window.__citadelAudiobookSyncDiagnostics.currentEntry()
{ secondsStart: 122.1, secondsEnd: 124.7, cfi: "/6/4[...]", sectionIndex: 3, label: "Chapter 3 ◈ ARYA" }
```

### `activeView()`

Return the resolved Foliate view information:

```
> window.__citadelAudiobookSyncDiagnostics.activeView()
{ key: "abc123-hash", primaryIndex: 3, totalSections: 42, href: "chapter3.xhtml" }
```

### `inspectAudioElement()`

Return the current `<audio>` element state:

```
> window.__citadelAudiobookSyncDiagnostics.inspectAudioElement()
{ src: "file:///.../book.mp3", duration: 3600.5, currentTime: 124.3, paused: false, readyState: 4 }
```

### `testHighlightAtCurrentTime()`

Force-apply the highlight for the current playback time (bypasses debounce):

```
> window.__citadelAudiobookSyncDiagnostics.testHighlightAtCurrentTime()
"Applied marker to /6/4[chap3]/2/4 at section 3"
```

---

## Integration Plan

When implemented:

1. Add a module at `apps/readest-app/src/utils/audiobookSyncDiagnostics.ts`.
2. In `useAudiobookPlayer`, if `process.env.NODE_ENV === 'development'`, attach the diagnostics object to `window.__citadelAudiobookSyncDiagnostics`.
3. The diagnostics object reads from the same stores and refs used by the sync hooks — it does not introduce new state.

---

## Current Status

**Not implemented.** The sync hooks (`useAudiobookPlayer.ts`, `useAudiobookSync.ts`) currently log diagnostics via `console.log` statements. These are sufficient for debugging the current `wip/combined-agent-output` branch. The structured diagnostics API above should be built in a follow-up infra task.
