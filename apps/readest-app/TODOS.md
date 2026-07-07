# TODOS

## Cloud Sync provider selection follow-ups (deferred by /autoplan, 2026-07-06)

Deferred from the Cloud Sync provider-selection plan (#4959/#4380). See the
Decision Audit Trail in the plan for reasoning.

- [ ] Pre-switch "download all Readest Cloud books" affordance so a fresh device
      gets full library completeness when a third-party provider is selected. (S)
- [ ] Library-page sync-status indicator for the active third-party provider
      (fileSyncStore already exposes aggregate progress). (S)
- [ ] Account page active-provider chip. (XS)
- [ ] File-engine parity: reading stats + per-book viewSettings sync via the
      file layout (readingStatus/tags parity shipped as its own PR). (M)
- [ ] Server-side quota error code (`code: 'quota_exceeded'`, mirroring the share
      import route) so the client stops string-matching 'Insufficient storage
      quota'; message drift silently restores retry behavior. (S)
- [ ] Pre-existing: Manage Sync "Books" category gates metadata rows but NOT
      binary uploads to Readest Cloud (`queueUpload` never consults
      `isSyncCategoryEnabled('book')` despite the category docs claiming it) —
      align behavior or docs. (S)
- [ ] Sentry `cloudSyncProvider` tag: Sentry tagging is Rust-mediated
      (`set_webview_info` pattern in `sentry_config.rs`); add a
      `set_cloud_sync_provider` command + before_send tag so sync-related
      reports carry the active provider. Console log lines ship in the
      meantime. (S, needs src-tauri)

Deferred items from the Edge TTS Web Audio plan review (/autoplan, 2026-07-04).
Each was explicitly deferred, not forgotten — see the Decision Audit Trail in
`.agents/plans/2026-07-03-edge-tts-webaudio.md`.

## TTS listening engine follow-ups

- [ ] Cross-section gapless playback: preload and schedule the next section's first
      sentence so chapter boundaries are as seamless as sentence boundaries. (M)
- [ ] Lock-screen ±10s seek offsets in addition to prev/next sentence. (S)
- [ ] Persist measured sentence durations per book so a reopened chapter starts
      with an exact timeline instead of estimates. (S)
- [ ] Worker offload for decode + WSOLA if device profiling shows main-thread jank
      on low-end Android. (S)
- [ ] Provider-agnostic voice source hedge: local neural TTS (e.g. Piper/Kokoro
      WASM) plugging into WebAudioPlayer/SectionTimeline — the engine is designed
      for this; see "Strategic framing" in the plan. (L)
- [ ] Background chapter prefetch (convert timeline estimates to exact durations
      ahead of playback). (M)
