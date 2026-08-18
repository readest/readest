---
name: git-push-prepush-hook-runs-full-suite
description: "`git push` takes ~8min (husky pre-push runs format+lint+full vitest); piping to tail MASKS its failure as exit 0"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 542d514e-6956-4262-987d-66a9d96afc34
  modified: 2026-08-17T09:44:23.301Z
---

`.husky/pre-push` runs three things before every push:

```
pnpm -C apps/readest-app format:check
pnpm -C apps/readest-app lint
pnpm -C apps/readest-app test
```

**Consequences when pushing from an agent session:**

1. **A push takes 5-8 minutes**, not seconds. A 120s or 180s Bash timeout kills it
   mid-hook. Always `run_in_background: true` and wait on the remote ref
   (`until git ls-remote --heads origin <branch> | grep -q refs/heads; do sleep 20; done`).
2. **`git push ... 2>&1 | tail -N` reports exit 0 even when the push FAILED** — the
   pipeline exit code is tail's. Nearly shipped a "pushed successfully" claim on a
   push that had been rejected by the hook. Either drop the pipe, capture
   `${PIPESTATUS[0]}`, or verify against `git ls-remote` before believing it.
   Read the output file to the end: the real signal is
   `husky - pre-push script failed (code 1)` / `error: failed to push some refs`.
3. **The hook's full-suite run flakes under load** where a foreground `pnpm test`
   passes. Observed 2026-08-17: `TTSPlayerSheet.test.tsx` and `TTSControl.test.tsx`
   failed in the hook run (`environment 1998s`) minutes after a clean 9393-pass
   foreground run (`environment 1310s`); both passed in isolation, and a plain
   retry of the push went green. Before chasing a "regression", re-run the named
   files alone and compare the `environment` timing between runs.

Since the hook already runs format:check + lint + test, a pre-push verification
pass of your own is duplicated work — but still worth it to get a clean signal
attributable to your change rather than to hook flake.

Related: [[build-ci-recipes]], [[feedback_dont_push_every_change]].
