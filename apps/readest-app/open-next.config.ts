import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';

const config = defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});

// Skip the deploy-time R2 incremental-cache populate step. The app uses no ISR /
// `revalidate` / `unstable_cache`, so the runtime incremental cache is a no-op
// anyway. Remove this line to re-enable (deploy from a network that can reach the
// Cloudflare edge).
config.dangerous = { ...config.dangerous, disableIncrementalCache: true };

export default config;
