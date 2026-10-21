---
name: feedback-pnpm-test-file-filter
description: "To run only some test files use `pnpm test --run <files>`, not `pnpm test -- --run <files>`"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a663ee0e-2061-4232-8c03-0cfded15f3e4
  modified: 2026-10-13T20:32:23.995Z
---

To run only specific unit test files, use `pnpm test --run <file-or-dir> ...` (no `--` separator), e.g. `pnpm test --run src/__tests__/services/tts src/__tests__/services/native-audio-player.test.ts`. With `pnpm test -- --run <files>` the filter does not apply as intended and it runs more than those tests. Running `pnpm vitest run <files>` directly skips the dotenv `.env`/`.env.test.local` loading that `pnpm test` does, so many TTS service tests fail spuriously.

**Why:** chrox corrected this on 2026-10-14 after I used the `--` form and also hit fake failures from bare `pnpm vitest`.

**How to apply:** for targeted runs always `pnpm test --run <paths>` (browser tests: `pnpm test:browser --run <paths>` likewise); for the full suite plain `pnpm test`. See [[build-ci-recipes]].
