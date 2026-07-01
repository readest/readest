---
name: i18n-extract-prunes-keys
description: "pnpm i18n:extract (removeUnusedKeys) deletes valid keys not statically in the branch; don't commit that churn"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: afe50e44-d394-4301-bd81-1368df66f90b
---

`pnpm run i18n:extract` (i18next-scanner, `i18next-scanner.config.cjs` has
`removeUnusedKeys: true`) can DELETE ~30+ valid-looking keys from every non-`en`
locale on a feature branch — keys whose source usage isn't statically present in
the current branch (e.g. `"Sync History"`, `"downloaded {{n}} book(s)"`,
`"Match Whole Words"`). The extract diff then shows huge churn (~1000 +/- lines)
unrelated to your change.

**Why:** the committed locales can be ahead of the branch's source (strings from
features not yet on this base, or built dynamically/in non-scanned modules), and
`removeUnusedKeys` strips anything the scanner can't find. `en/translation.json`
is a tiny key-as-content file (~70 lines, only plural/proper-noun overrides), so
new keys never land there anyway — it stays out of the diff.

**How to apply:** for a feature that adds a few strings, do NOT commit the
scanner's deletions into an unrelated PR.
1. Run `pnpm run i18n:extract` (optional — only confirms which keys are new).
2. `git checkout -- apps/readest-app/public/locales` to drop ALL the churn.
3. Add ONLY your new keys manually to each locale in `i18n-langs.json` with real
   translations. The files are exactly `JSON.stringify(obj, null, 2) + "\n"`, so
   a Node script that `JSON.parse`s, appends new keys (insertion order preserved),
   and rewrites that way yields a zero-extra-diff result. Skip `en` (key-as-content).

Match each locale's existing terminology (grep the file for a related key, e.g.
`"Export Annotations"` / `"Annotations"`, before translating). Verify with
`grep -rn '"<Your Key>"' apps/readest-app/public/locales | wc -l` == number of locales.

Related: [[feedback_en_plurals_manual]].
