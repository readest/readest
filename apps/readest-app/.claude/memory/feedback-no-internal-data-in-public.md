---
name: feedback-no-internal-data-in-public
description: "Never put internal user/business data (buyer counts, audit results, user ids, payment ids, emails) in commits, PR bodies, issues or review replies"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01b6a844-8ddb-4ea3-89d9-88595125f67d
  modified: 2026-09-21T15:09:26.880Z
---

Commits, PR descriptions, issue text and review replies on readest/readest are public. Never include internal user or business data there: buyer/user counts, audit figures or dates from production DB queries, user ids, payment/session ids, emails, revenue. Describe the mechanism ("each buyer already holds a grandfather row"), not the numbers behind it.

**Why:** chrox had me strip "2733/2733 storage buyers" and the audit date from PR #6337 and its commit (2026-09-21): "don't leak any internal user data in commits and prs".

**How to apply:** before every commit/PR/comment, scan the text for figures or identifiers that came from prod data or private memory files (e.g. [[storage-customization-entitlement-split]], [[api-route-auth-audit-2026-08]]) and remove them. Public CI run links and code references are fine.
