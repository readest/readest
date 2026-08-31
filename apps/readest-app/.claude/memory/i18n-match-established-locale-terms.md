---
name: i18n-match-established-locale-terms
description: "When translating new i18n strings, reuse the locale file's own established term for a domain noun instead of inventing a synonym"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6981cf12-3457-45a5-8161-d15457b41f63
  modified: 2026-08-30T16:38:58.863Z
---

When filling `__STRING_NOT_TRANSLATED__` placeholders, look up how the locale ALREADY
translates each domain noun and reuse that exact lexeme. Do not translate the English
word fresh, because a correct-but-different synonym still reads as an inconsistency in
the UI.

Check before writing, per locale:
`jq -r '.["Highlights"], .["Notes"], .["Bookmarks"]' public/locales/<l>/translation.json`

Audit after writing (case-fold + stem, because inflection and case legitimately differ;
an exact substring match over-flags badly - it wrongly flagged French `Surlignages` vs a
correctly lowercased mid-sentence `surlignages`):

```sh
hlf=$(printf '%s' "$hl" | tr '[:upper:]' '[:lower:]'); stem=$(printf '%s' "$hlf" | cut -c1-5)
case "$minef" in *"$stem"*) : ;; *) echo "MISMATCH" ;; esac
```

**Why:** on PR #5949 I filled 582 strings across 34 locales and invented the "highlights"
noun in 6 of them (es `subrayados` vs established `Resaltados`; ka `მონიშვნები` vs
`მარკირებები`; also ar, ms, si, uz). CodeRabbit caught two; the audit above found the
rest.

**How to apply:** run the audit across ALL locales, not only the ones a reviewer flags.
Some locale files are internally inconsistent already (bo has Highlight=`འོག་ཐིག`
underline but Highlights=`གཙོ་གནད།` key-points; zh-TW has Highlight=`劃線` vs
Highlights=`標記`) - those have no established term, so leave them and ask rather than
guessing.

Related: [[i18n-extract-prunes-keys]], [[i18n-label-rename-workflow]],
[[notion-sync-pr-5949-review]]
