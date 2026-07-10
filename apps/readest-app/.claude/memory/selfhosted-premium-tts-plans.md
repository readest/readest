---
name: selfhosted-premium-tts-plans
description: Readest Voice (self-hosted premium TTS) — spec + two implementation plans APPROVED via /autoplan 2026-07-08; implementation not started
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e5c8779-6af2-41a8-b56e-6472beec368b
---

Self-hosted premium TTS ("Readest Voice"): Kokoro v1.0 + v1.1-zh (Plus tier, EN/ZH/JA/FR) and Qwen3-TTS-12Hz-1.7B-CustomVoice (Pro tier, adds DE) served from a RunPod Serverless GPU worker, integrated as a new `readest-tts` engine with Edge-parity wire format (`X-TTS-Word-Boundaries`, 100ns ticks). Word timestamps via wav2vec2-CTC forced alignment (Apache-2.0 checkpoints only; MMS_FA is CC-BY-NC — banned).

**Documents (all on dev, plans dir is local-only/gitignored):**
- Spec: `docs/superpowers/specs/2026-07-08-selfhosted-premium-tts-design.md`
- Service plan (separate repo `readest-tts-server`): `.agents/plans/2026-07-08-readest-tts-server.md`
- App integration plan: `.agents/plans/2026-07-08-readest-tts-integration.md` (contains all 3 review reports + 30-row decision audit trail)

**Key user decisions (do not re-litigate):** gating plus/pro ONLY (purchase excluded — recurring GPU cost); quotas 100K/300K chars/day; self-hosted kept over managed-API despite both review models challenging it (cloning path + supplier independence); word-level alignment kept in v1; cold starts accepted but softened by warmup ping on voice-picker open (adopted at gate) + slow-start toast; usage meter and free-user upsell entry DECLINED; Edge stays default engine (premium is opt-in, `setVoice('')` must never match readest voices).

**Load-bearing technical facts:** `fetchWithAuth` THROWS on non-OK with body.error as message (route error bodies must be flat strings); `merge_tokens` needs `blank=blank_id`; kokoro 0.9.4 yields Result dataclasses (verified vs pipeline.py); per-language GPU alignment tests + smoke `word_level` assertion guard silent sentence-level fallback; day-60 kill criterion (<3% adoption) in spec.

**Status 2026-07-08 (late):** IMPLEMENTED. Integration branch `feat/readest-tts` (worktree /Users/chrox/dev/readest-feat-readest-tts, 9 commits, local-only, final review READY TO MERGE, 7118 unit + 217 browser tests green). Server repo /Users/chrox/dev/readest-tts-server (15 commits, no remote, final review READY pending infra gates; 28 CPU tests green, gpu suite deselected). Executed via subagent-driven development: 12 tasks, every task adversarially reviewed; notable catches: fetchWithAuth-throws contract, merge_tokens blank id, U+2019 unicode flattening (twice — agents flatten smart quotes/vowel signs in file writes; use \u escapes and verify by codepoint probe).

**Remaining (infra-gated):** fill 9 `<pin-commit-sha>` HF revisions in scripts/download_weights.py; pick container registry (Docker Hub vs GHCR); docker build on amd64; `pytest -m gpu` on a GPU pod; RunPod endpoint per docs/deploy.md; smoke.py; comparative listening QA vs Edge; then app manual smoke (Task 7 step 3), PR + push after user confirms. Verify at deploy: CF Workers poll-duration, negative-increment RPC support.
