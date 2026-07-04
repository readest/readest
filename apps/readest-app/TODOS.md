# TODOS

Deferred items from the Edge TTS Web Audio plan review (/autoplan, 2026-07-04).
Each was explicitly deferred, not forgotten — see the Decision Audit Trail in
`.agents/plans/2026-07-03-edge-tts-webaudio.md`.

## TTS listening engine follow-ups

- [ ] Cross-section gapless playback: preload and schedule the next section's first
      sentence so chapter boundaries are as seamless as sentence boundaries. (M)
- [ ] Buffer-ahead indicator in the TTS scrubber (show the prefetched region,
      YouTube-style). (S)
- [ ] Lock-screen ±10s seek offsets in addition to prev/next sentence. (S)
- [ ] Persist measured sentence durations per book so a reopened chapter starts
      with an exact timeline instead of estimates. (S)
- [ ] Worker offload for decode + WSOLA if device profiling shows main-thread jank
      on low-end Android. (S)
- [ ] Sticky TTSBar scrubber (panel + lock screen only in the first release;
      recorded as deliberate in decision #24). (S)
- [ ] Provider-agnostic voice source hedge: local neural TTS (e.g. Piper/Kokoro
      WASM) plugging into WebAudioPlayer/SectionTimeline — the engine is designed
      for this; see "Strategic framing" in the plan. (L)
- [ ] Background chapter prefetch (convert timeline estimates to exact durations
      ahead of playback). (M)
