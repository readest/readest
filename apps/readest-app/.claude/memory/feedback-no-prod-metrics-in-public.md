---
name: feedback-no-prod-metrics-in-public
description: Never put production operational details (DB/table sizes, instance specs, query rates/timings, user counts, growth rates, infra names) in public GitHub issues/PR bodies; keep specs with such data on local disk
metadata:
  type: feedback
---

On 2026-08-23 the user deleted issue #5834 (stat_pages R2 tiering spec) because it exposed too much production information in the public readest/readest repo (table sizes, growth rate, instance RAM/disk, per-user row distributions, query call rates). They asked for the spec to be kept on local disk instead.

**Why:** readest/readest is public; operational numbers about the production Supabase/Cloudflare deployment are sensitive even when no secret or PII appears, and the gstack redaction scan (secrets/PII only) does not catch them.

**How to apply:** Public issues and PR descriptions get the technical rationale without production numbers (say "the lookup re-walks the PK range per array element", not "2.27M calls / 17% of DB time / 39 GB DB"). Keep full specs and investigations in local-only locations: `~/.gstack/projects/readest-readest/specs/` (gstack archive) or the user's memory dir; NOT `apps/readest-app/.claude/` (that tree, including `.claude/memory/`, is tracked in the public repo). PR #5832 and #5833 descriptions were scrubbed of production numbers on 2026-08-23 (`gh pr edit`); the merged COMMIT MESSAGES on main still carry a few phrases ("about 9 req/s in production", "~70k page events") and were left alone (no history rewrite).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [No prod metrics in public issues/PRs](feedback-no-prod-metrics-in-public.md) #5834 DELETED by user for exposing prod data; specs stay local (~/.gstack/projects/readest-readest/specs/), NOT in the tracked .claude/ tree; PR #5832/#5833 bodies scrubbed 2026-08-23 (commit messages untouched)
