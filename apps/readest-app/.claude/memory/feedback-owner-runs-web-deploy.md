---
name: feedback-owner-runs-web-deploy
description: "The owner deploys the web server (Cloudflare Worker, pnpm deploy) themselves; agents merge and report, they don't run the deploy"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 501a9ec1-5fb6-45a8-912a-e2c21ace66c7
  modified: 2026-11-25T21:02:11.061Z
---

When a merged change needs the web server redeployed, the owner runs the Cloudflare deploy themselves. On 2026-11-26 (#7940, gift product ids `_1y`), I was asked to "merge the _1y change and redeploy the server". While I was preparing `pnpm run deploy`, the owner said: "I will deploy it myself". Earlier the same day the gift feature (#7930) went out the same way ("server deployed").

**Why:** a production deploy is the owner's call: when it happens, and what else ships with it.

**How to apply:**
- Merge, then say clearly that the change needs a deploy and what depends on it.
- Don't run `pnpm deploy`/`pnpm upload` unless the owner asks in that conversation and doesn't take it back.
- Related: [[deploy-workers-dev-sni-proxy]], [[cf-worker-64mb-turbopack-regression]].
