---
name: nextjs-app-dir-reserved-route-filenames
description: A helper named layout.ts anywhere under src/app/ is parsed by Next as a route segment layout and fails the web build; pnpm lint never sees it
metadata: 
  node_type: memory
  type: project
  originSessionId: f8af7206-a4f1-42d4-81f5-51d3c99767b7
  modified: 2026-08-14T15:40:23.341Z
---

`src/app/` is the Next App Router tree, so Next claims the **reserved filenames**
(`layout`, `page`, `route`, `template`, `loading`, `error`, `not-found`, `default`)
in *every* directory beneath it — including plain helper directories like
`src/app/reader/utils/`. A helper at `src/app/reader/utils/layout.ts` is compiled
as the route layout for segment `/reader/utils` and fails typegen:

```
Type error: Type 'typeof import(".../src/app/reader/utils/layout")' does not
satisfy the constraint 'LayoutConfig<"/reader/utils">'.
```

**`pnpm lint` (tsgo + biome) does not catch this** — the constraint lives in the
generated `.next/types` route manifest, so only `pnpm build-web` / `next build`
fails. That makes it a green-locally, red-in-CI trap: it took down `build_web_app`
on PR #5708 while test, lint and format were all clean.

Fix is just the filename: `mobileLayout.ts` instead of `layout.ts`. Prefix or
qualify any helper in `src/app/**` whose bare name collides with the reserved set.

Before pushing anything that adds a file under `src/app/`, run `pnpm build-web`
once, not just `pnpm lint`. Related: [[nextjs-page-export-webpack-only-check]] —
same shape of failure (build-only check, invisible to lint).
