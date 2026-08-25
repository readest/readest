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
`build` mode as en-vi. **One kaikki download serves every kaikki-sourced en-X pair**, so adding
another target is just one build command. Since 2026-08-25 that download is the RAW dump
`.sources/raw-wiktextract-data.jsonl.gz` (the old `.sources/kaikki-en.jsonl` is the DEPRECATED
post-processed file); en-hu was regenerated from it with 652 first-sense fixes. See
[[wordlens-en-vi-pack-5737]].

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

**PUBLISHED 2026-08-20 ~16:33 UTC** (four days after merge). A reporter on #5738 said "I can't select
Hungarian" on the nightly; the live manifest still had 14 packs. The user ran
`WORDLENS_R2_BUCKET=cdn-readest-com pnpm wordlens:sync` themselves; a second run correctly printed
"already up to date" (the script's own remote check is trustworthy). Verified: R2 object and CDN both
list 16 packs, `en-hu.json`/`en-vi.json` bytes on the CDN match their manifest sha256.

**Bucket name is `cdn-readest-com`.** Diagnose with `curl -sS https://cdn.readest.com/wordlens/manifest.json | jq '[.packs[].pair]'`
(curl honours `https_proxy=127.0.0.1:8118`, Node's fetch in the sync script does NOT — both saw the
same data here, but keep that in mind if they ever disagree).

**Client caches the manifest per session** (`manifestPromise` in `glossPacks.ts`, only
`WordLensPanel.tsx:82` fetches it, never with `force`), so after a publish the user must restart the
app before the new target appears in the hint picker.
