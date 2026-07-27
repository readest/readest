---
name: nextjs-page-export-webpack-only-check
description: "Non-default exports from app-router page.tsx break only the --webpack (OpenNext Cloudflare deploy) build, not pnpm build-web/turbopack; found via #5237's test-only ProviderLogin export"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7191523e-9cbb-45ca-a461-8a9ab8f9d0b0
  modified: 2026-07-26T06:38:35.611Z
---

Next 16 type-checks app-router **page export fields** (`NextTypesPlugin` generates
`.next/types/app/**/page.ts` with `checkFields<Diff<{default, metadata, generateMetadata,
revalidate, dynamic, ...}, TEntry>>`). Any extra export fails with
`Type error: Page "..." does not match the required types of a Next.js Page. "<Name>" is
not a valid Page export field.`

**Only the webpack build runs this check.** `pnpm build-web` / `pnpm build` use turbopack
and skip it entirely, so a bad page export passes every local gate and only explodes in
`pnpm deploy` / `pnpm preview` / `pnpm upload` (all three do
`patch-build-webpack && opennextjs-cloudflare build`, and `patch-build-webpack` rewrites
`next build` to `next build --webpack` in package.json).

Hit on 2026-07-26: PR #5237 added `export const ProviderLogin` to
`src/app/auth/page.tsx` purely so `src/__tests__/app/auth-page.test.tsx` could import it.
That broke the Cloudflare deploy build on `main` and went unnoticed because CI/local only
run turbopack builds. Fix = move the component to `src/app/auth/components/ProviderLogin.tsx`
(co-located non-route files in the app dir are fine) and import it from both the page and
the test. MERGED PR #5336 (65d22f32a).

**CI does not cover this.** No workflow runs a webpack build, so the same class of break
can land again. If page-export mistakes recur, that gap is the thing to fix.

**Rule:** a `page.tsx` exports `default` and Next's recognized config fields, nothing else.
If a test needs a piece of it, extract that piece to its own module.

**Gotcha while debugging:** `.next/types/**/*.ts` is in the tsconfig include, so once a
`--webpack` build has run, a stale `.next/types` makes `pnpm lint` (tsgo) fail on the
generated validator even after switching branches. `rm -rf .next` before re-linting.

**Attribution technique** (dep bump vs pre-existing): `next-types-plugin/index.js` was
byte-identical between 16.2.6 and 16.2.11, and re-running `pnpm build-web` with
`patch-build-webpack` applied on the base commit reproduced the failure. See
[[deps-security-overrides-workflow]].
