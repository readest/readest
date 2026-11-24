---
name: feedback-private-memory-for-ops-data
description: Memories with operational data (costs, prod log numbers, IPs, keychain/token locations, infra internals) go in gitignored `private-*.md` files, never in tracked memory files
metadata:
  type: feedback
---

The memory dir is the repo's tracked `apps/readest-app/.claude/memory/` and the repo is public. Anything with operational data — cloud bills, usage/traffic numbers, prod log findings, third-party IPs, secret/token locations, infra internals — goes in a file named `private-<slug>.md` (gitignored by `.claude/memory/private-*.md`). The tracked memory keeps only the plan/decision and links to the private file with `[[private-...]]`; the MEMORY.md index line for a private file states no figures.

**Why:** chrox, 2026-11-03: the Cloudflare cost memory "should not be committed to the repo as it contains many operational data".

**How to apply:** before writing or extending a memory, ask whether a public reader could use it to learn costs, traffic, infra layout or how to reach prod credentials; if yes, write it to a `private-` file. Related: [[feedback-no-internal-data-in-public]].
