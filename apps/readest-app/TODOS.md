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

## Self-hosted premium TTS follow-ups (deferred by /autoplan, 2026-07-08)

Deferred from the Readest Voice plans (spec: docs/superpowers/specs/2026-07-08-selfhosted-premium-tts-design.md).
See the Decision Audit Trail in .agents/plans/2026-07-08-readest-tts-integration.md.

- [ ] Dict-popup premium pronunciation: route the dictionary speak button through
      /api/tts/readest for eligible plans (reuses the wire contract as-is). (M)
- [ ] Voice preview samples in the TTS voice picker (pre-generated clips per voice,
      static hosting; no GPU call on tap). (M)
- [ ] Qwen3 instruct-based emotion/style control as a Pro setting (API already
      supports `instruct`; needs UX + catalog plumbing). (M)
- [ ] Warm-worker peak-hours schedule (RunPod min-workers=1 on a cron) if cold-start
      complaints materialize; premise-4 mitigation. (S)
- [ ] Client-side cold-start abandonment telemetry (did the user give up before
      first audio?) to complete the day-60 review data. (S)
- [ ] Comparative MOS-style voice regression harness vs Edge/native/managed APIs
      (post-demand; the launch gate is a one-shot A/B listen). (M)
- [ ] On-device Kokoro exploration for offline premium voices (desktop first; 82M
      params runs near-realtime on CPU) — if accepted as taste decision, this moves
      into a phase-2 plan instead. (L)
- [ ] Cancel in-flight RunPod jobs on client abort: forward AbortSignal through
      the route and call /cancel/{id} so a stop during a cold start does not
      burn a full GPU job. V1 keeps signal-less fetches deliberately (in-flight
      dedup shares one promise across preload and playback, Edge parity). (S)
- [ ] Extend the TTS browser e2e harness with a mocked /api/tts/readest so the
      premium engine's playback + highlight path gets automated coverage. (M)
- [ ] Per-user in-flight request cap (1-2) on /api/tts/readest to complement the
      char quota (needs shared state on Workers: KV or DO). (M)
- [ ] Delegate uncovered-language marks to Edge TTS instead of skipping them
      (cross-engine per-sentence delegation; v1 skips the sentence). (M)
- [ ] End-to-end request id: client generates one per sentence, route forwards it
      in the RunPod input, worker logs it — full-path correlation in one grep. (S)
- [ ] Generate the shared voice catalog (voices.json + catalogVersion) from
      readestVoices.ts instead of hand-syncing the worker fixture. (S)
