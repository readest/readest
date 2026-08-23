// Custom Cloudflare Worker entry (wrangler.toml `main`). Wraps the handler that
// `opennextjs-cloudflare build` generates and adds a `scheduled()` handler so
// the Cron Trigger can drive the reading-statistics compaction endpoint
// (POST /api/stats/compact). Pattern from the OpenNext "custom worker" how-to:
// https://opennext.js.org/cloudflare/howtos/custom-worker
//
// `.open-next/worker.js` only exists after the OpenNext build step that
// `pnpm preview` / `pnpm deploy` run first; wrangler bundles this file with it.
// The file sits outside tsconfig's `include`, so it carries its own minimal
// types (the project does not depend on @cloudflare/workers-types).

// biome-ignore lint/suspicious/noTsIgnore: `.open-next/worker.js` only exists after the OpenNext build
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from './.open-next/worker.js';

interface CompactEnv {
  STATS_COMPACT_TOKEN?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const COMPACT_URL = 'https://web.readest.com/api/stats/compact';

export default {
  fetch: handler.fetch,

  async scheduled(_event: unknown, env: CompactEnv, ctx: ExecutionContextLike) {
    // Same code path as a manual run: the route applies the 503/401 guard, so
    // a disabled or unconfigured deployment just logs a 503 here.
    const req = new Request(COMPACT_URL, {
      method: 'POST',
      headers: { 'x-compact-token': env.STATS_COMPACT_TOKEN ?? '' },
    });
    ctx.waitUntil(
      handler
        .fetch(req, env, ctx)
        .then((res: Response) => {
          if (!res.ok) console.warn('stats compact cron: status', res.status);
        })
        .catch((e: unknown) => {
          console.error('stats compact cron: failed', e instanceof Error ? e.message : e);
        }),
    );
  },
};

// OpenNext's DO queue / DO tag cache classes (DOQueueHandler, DOShardedTagCache)
// would have to be re-exported here if open-next.config.ts ever enabled them;
// today it only sets the R2 incremental cache, so there is nothing to re-export.
