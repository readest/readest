---
name: typescript-7-upgrade-5260
description: TS7 upgrade (#5260) — TS7 has no JS compiler API and no tsserver; Next 16.2 hard-rejects TS>=7 so next must go to 16.3; tsgo bin is gone, lint runs tsc
metadata:
  type: project
---

Issue #5260 "Upgrade to Typescript 7". Authored on `feat/typescript-7-upgrade`
(commit d3a584ed3, worktree `/Users/chrox/dev/readest-feat-typescript-7-upgrade`),
**MERGED #5893 as squash `09ce80872` (2026-08-26T17:47Z)**; worktree removed, branch
`feat/typescript-7-upgrade` and the `dev-backup-pre-rebase` safety branch deleted, remote
branch auto-deleted by GitHub. The squash carries all 8 files including the nix hash.
`dev` still holds its own duplicate copy (`eca707c40`) awaiting the usual
`git reset origin/main`.
`dev` is local-only (tracks origin/main, no origin/dev) and now sits directly on
origin/main + this one commit, because chrox reset dev to origin/main mid-flight.

**Rebase gotcha for next time:** `dev` had accumulated 7 local commits that were
the UNSQUASHED originals of PR #5884, so `git rebase origin/main` conflicts
immediately on `feat(ui): migrate to daisyUI 5` and every one of those commits
needs `git rebase --skip`. In this session `git rebase --skip` was BLOCKED by the
Claude Code auto-mode permission classifier (`git rebase origin/main` and
`git cherry-pick` were both allowed) — so a rebase of dev cannot be driven from
an auto-mode agent turn without an explicit Bash allow-rule. `git reset origin/main`
(mixed) is the shortcut chrox used: it drops the duplicates and preserves the
working tree, turning files absent from main (e.g. the daisyUI memory doc) into
untracked ones rather than deleting them.

**The three facts that shape the whole upgrade:**

1. **`typescript@7` is a different package shape.** Root export is only
   `lib/version.cjs` — the JS compiler API is GONE. No `tsserver` either. Bins:
   `tsc` only (no `tsgo`). Subpath exports are `typescript/unstable/{sync,async,fs,proto,ast,...}`.
   The native binary ships via `optionalDependencies` `@typescript/typescript-<platform>`.
   `@typescript/native-preview` stopped publishing after `7.0.0-dev.20260707.2` —
   it graduated into `typescript@7`. So the migration is
   `@typescript/native-preview` -> `typescript@^7`, and `tsgo` -> `tsc` in `pnpm lint`.

2. **Next.js 16.2 rejects TypeScript >= 7.0 outright** (vercel/next.js#96110 style
   guard) — this is exactly what chrox meant in the issue comment about waiting for
   16.3. Next 16.3 added the TypeScript CLI backend (#95639) and enabled it by
   default (#96497, merged 2026-08-03, hours before 16.3.0 shipped):
   `experimental.useTypeScriptCli: true` in `config-shared.js`. It shells out to the
   project-local `tsc` for build-time type checking AND tsconfig loading. With TS7
   installed there is no API fallback at all — `verifyAndRunTypeScript` throws
   `getTypeScriptApiMissingError` when `!useTypeScriptCli && !installedTypeScript.apiPath`.
   **Consequence:** `pnpm lint` and `next build` now run the IDENTICAL Go checker.
   The old setup had a real second opinion (tsgo for lint, TS5 API for `next build`) —
   that redundancy is gone and cannot be restored while TS7 is the only `typescript`.
   See [[save-image-to-gallery-android]], whose "tsgo misses abstract conformance,
   real tsc catches it" advice is now unactionable for that reason. (A synthetic
   abstract-implements-interface repro is caught identically by tsgo dev.20260312,
   tsc 5.9.3 and tsc 7.0.2, so the exact original trigger was narrower than recorded.)

3. **TS 7.0.2 enforces the inferred `rootDir` even under `noEmit`** — a behavior
   change vs `@typescript/native-preview@7.0.0-dev.20260312.1`, verified by running
   the old tsgo against the same tsconfig (25 errors) vs tsc 7.0.2 (36). The app
   inherits `outDir: "${configDir}/distribution"` from `@sindresorhus/tsconfig`,
   which makes TS7 infer rootDir = the app dir, so the `js-mdict` sources mapped in
   from `packages/js-mdict/src/` all tripped **TS6059**. `"declaration": false` does
   NOT fix it (outDir is what drives the inference); `"rootDir": "../.."` does.

**Other fallout:** Next 16.3 added a required `bfcacheId: string` to
`AppRouterInstance`, so the single `mockRouter()` helper in
`src/__tests__/utils/nav.test.ts` needed it (was 25 TS2741 errors from one helper).

**What deliberately stays on TypeScript 5:** the `send-to-readest` browser
extension uses `ts-loader`, which needs the JS compiler API TS7 removed. The two
Cloudflare workers (`workers/iap-reconcile`, `workers/send-email`) and the root
package.json also stay on 5 — their `typecheck` scripts are not wired into CI or
`pnpm lint`, so moving them buys nothing. All the resulting unmet-peer warnings
(`tsconfck@^5.0.0`, `i18next@^5`, `react-i18next@^5`) are OPTIONAL peers used only
for type inference; nothing breaks.

**PR #5893 CI was ALL GREEN before merge.** All 16 checks passed incl.
build_web_app (4m19s), build_tauri_app (3m28s), test_web_app 1+2, test_extensions,
rust_lint, nix_flake_check, fod-hashes (2m43s after the bump), CodeQL x4. CodeRabbit:
"No actionable comments." So `next build` under the TypeScript CLI backend works on CI
Linux for BOTH the web and tauri targets, not just this Mac.

**Verified green in the worktree:** `pnpm lint` (tsc 7.0.2 + biome), `pnpm test`
(826 files / 10135 tests), `pnpm test:browser` (42 / 381), `pnpm test:extension`
(7 / 54), `pnpm build-web` ("Running TypeScript ... Finished TypeScript in 7.0s"),
`pnpm check:all`, `pnpm build-browser-ext`, `pnpm format:check`. Next did NOT
rewrite tsconfig.json during the build. The serwist/Turbopack and
"middleware convention is deprecated" build warnings are PRE-EXISTING (present in
16.2.11's dist too) — not caused by the bump.
