---
name: wordlens-en-hu-pack-5738
description: en-hu pack built from the cached kaikki dump (WikDict has no hu either); hu is target-only because it is agglutinative
metadata: 
  node_type: memory
  type: project
  originSessionId: e4c7a4f1-f9d0-4f42-85e8-baf26235aa7d
  modified: 2026-08-16T07:22:44.100Z
---

PR #5738 (2026-08-16) adds `en-hu`, plus the review follow-up to #5737's sync.

**WikDict has no Hungarian either** (`en-hu.sqlite3` = 404), so `en-hu` uses the same kaikki
`build` mode as en-vi. The cached `data/wordlens/.sources/kaikki-en.jsonl` already covered it:
**one 3.2 GB download serves every kaikki-sourced en-X pair**, so adding another target is now
just one build command, no download. See [[wordlens-en-vi-pack-5737]].

**13,641 entries** — far better than en-vi's 9,759 and close to en-es (14,769) / en-de (14,926).
Hungarian Wiktionary translation coverage is good. Per-band: 1k+:868 2k+:1496 4k+:2298 8k+:2642
14k+:3323 24k+:3014.

**hu is target-only, like vi.** Hungarian is agglutinative ("házaimban"), so X->en would need a
lemmatizer and michmech publishes no Hungarian list. Neither language is blocked in
`canTokenizeSource` — the absent pack is the whole mechanism.

**MERGING DOES NOT PUBLISH.** Checked the live CDN right after #5737 merged: it still listed 14
packs, so `en-vi` was merged but invisible to clients. Packs live in R2, not the bundle. Always
run `WORDLENS_R2_BUCKET=<bucket> pnpm wordlens:sync` after a pack PR merges, and verify with
`curl -s https://cdn.readest.com/wordlens/manifest.json | jq '.packs[].pair'`.
