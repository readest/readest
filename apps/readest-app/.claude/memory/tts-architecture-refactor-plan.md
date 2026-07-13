---
name: tts-architecture-refactor-plan
description: "Approved direction for TTS provider/cache refactor, scheduled after PR#5085 merges"
metadata: 
  node_type: memory
  type: project
  originSessionId: 953eb6c3-86a7-43e6-b56e-5b14f2eacb28
---

TTS architecture research (2026-07-13) concluded the <audio> -> WebAudio -> iOS-native playout evolution was right: synthesis and playout are separate planes; playout is a per-platform driver (WebAudio on Web/Desktop/Android, AVPlayer on iOS for session ownership). Do NOT go native on more platforms.

**Approved follow-up refactor (user: "After PR is merged, we will refactor as described above")**, full doc at `apps/readest-app/.claude/plans/2026-07-13-tts-architecture-research.md` (gitignored, local only):
1. Declare `TTSAudioPlayer` + `TTSCapabilities` interfaces (type-only).
2. Extract `SpeechProvider` contract from EdgeSpeechTTS; EdgeTTSClient becomes `BufferedTTSClient(provider)`. Invariants: rate never sent to provider (playout applies it; keeps cache rate-independent); Edge boundary wire shape.
3. `CachingProvider` + `CacheStore` (Tauri fs first, web OPFS later); key hash(providerId, voice, pitch, text); per-provider `cacheable` flag (licensing).
4. Readest Voice provider ([[selfhosted-premium-tts-plans]]) validates the seam.
5. iOS playout_enqueue by cache-file path (drop base64).
6. Local-model provider (desktop first), then maybe synth-to-buffer for system voices (iOS boundaries reconstructable during AVSpeechSynthesizer.write; Android onRangeStart lacks timestamps in file mode).

**Why:** all planned engines differ only in fetch + boundary format; scheduler/WSOLA/word-tracking should be written once. See [[ios-tts-media-session-native]] for the playout saga and session invariants.

**PR #5085** (feat/native-tts-playout, 3 squashed commits: CarPlay+tao submodule, Android focus, iOS native playout+volume-key) carries all of it; submodules need fork branches `readest/tauri@readest-2.11` and `readest/tao@readest-0.35` (both pushed 2026-07-13; tao = tag tao-v0.35.3 + UAF fix da30a3b9 ONLY (lint allow reverted; CI fixed via rustflags:'' in pull-request.yml)). Local `dev` still has the unsquashed 9-commit history (tao vendored there, submodule only on the PR branch); after merge, reset dev onto origin/main.
