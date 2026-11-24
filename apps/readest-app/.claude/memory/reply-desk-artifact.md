---
name: reply-desk-artifact
description: "The loops' Reply Desk is artifact Kth6ivFM1MMX6dXrhCbnf7 (drafts collection, owner-only rules); created 2026-10-31; URL lives in ~/.local/state/readest-loops/config.json"
metadata:
  node_type: memory
  type: reference
  originSessionId: 7460d824-4711-4f63-8f06-498530415afa
  modified: 2026-10-31T19:18:16.951Z
---

Reply Desk: https://claude.ai/artifact/Kth6ivFM1MMX6dXrhCbnf7 — created 2026-10-31 when `config.json` didn't exist yet (the triage skill refuses to draft without it).

- `~/.local/state/readest-loops/config.json` = `{"replyDesk": "<url>"}`. If that file is lost, recreate it with this URL; don't publish a second desk.
- db rules: root `read: admin, write: owner` (verified an `interact` read sees nothing). Capabilities `db` + `user`.
- The page writes `edited` (null when equal to `draft`), `note`, `status` (approved/dropped/back to pending) and `decidedAt`. Loops write everything else.
- To change the page from another session: `Artifact read` the URL first, then publish with `url`.
