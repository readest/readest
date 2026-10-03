---
name: embedded-font-generic-rewrite-6047
description: #6047 embedded book fonts MERGED f5ec1e5f3; generic-family rewrite must be scoped per list item, and !important never beats specificity so the pre/code selector swaps with the override toggle
metadata:
  type: project
---

PR #6047 `fix/embedded-book-fonts` (external contributor k6G52m4Dz75W), reviewed
2026-09-04 against origin/main 049ed2cda. MERGED as squash f5ec1e5f3 (chrox,
2026-09-04), with both review defects below fixed first by follow-up commits
24cc21e and cdc9305 pushed to the contributor's fork. Both fixes and
code-font-override.browser.test.ts confirmed present in the squash. NOT
verified on a device.

**Pushing to a fork PR without rewriting the contributor's history:**
`pnpm worktree:new <pr>` REBASES, so committing there and pushing would force.
Instead build the commit on the REAL head with plumbing, no checkout needed
(the submodule pins differ between the real and rebased head, so switching the
worktree is the expensive path):
```
TREE=$(git merge-tree --write-tree --merge-base=<rebased-head> <real-pr-head> <my-commit>)
NEW=$(git commit-tree $TREE -p <real-pr-head> -F msg.txt)
GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30" git push --no-verify \
  git@github.com:<fork-owner>/readest.git $NEW:refs/heads/<branch>
```
The fork remote is registered with an HTTPS URL; push the SSH URL explicitly or
the SOCKS proxy is not used. `maintainerCanModify: true` is required.

**The bug it found is real and I reproduced it.** On main,
`transformStylesheet` turns
`@font-face { font-family: Source Han Serif CN; }` into
`@font-face { font-family: Source Han var(--serif, serif) CN; }`. `@font-face`
descriptors cannot contain `var()`, so the whole rule is dropped and the book's
embedded font detaches. Cause: `.replace(/(font-family\s*:[^;]*?)\bserif\b(?!-)/gi, ...)`
matches the word anywhere in the value, including inside the family NAME.

**Defect 1 in the fix (P1) - FIXED in 24cc21e.** Deleting the rewrite outright is too broad. The
"body generic-unset pass" the PR cites as the fallback (style.ts ~1182-1195)
only fires when the selector contains `body` AND the value is exactly `serif`
or `sans-serif`. Measured before/after: `p { font-family: serif }`,
`div.calibre { font-family: serif }`, `.code { font-family: monospace }` and
`body { font-family: "FZSongTi", serif }` all stop resolving to the user's
chain and fall to the SYSTEM generic. `--serif` carries the CJK chain from
`buildFontFamilyLists`, so Default CJK Font silently stops applying to CJK
books - the exact population the PR targets.

**Correct fix (shipped): rewrite whole comma-separated list items only.** It
must also park a trailing `!important` before splitting, or `serif !important`
stops matching. Verified (fixes the @font-face corruption, keeps the feature, and is
idempotent, so the #5277 placeholder machinery can go away too):

```ts
.replace(
  /(font-family\s*:\s*)([^;{}]*)/gi,
  (_m: string, prefix: string, value: string) =>
    prefix +
    value
      .split(',')
      .map((item: string) => {
        const generic = /^(serif|sans-serif|monospace)$/i.exec(item.trim());
        if (!generic) return item;
        const name = generic[1]!.toLowerCase();
        return item.replace(generic[1]!, `var(--${name}, ${name})`);
      })
      .join(','),
)
```
Idempotent because a second pass splits `var(--serif, serif)` into `var(--serif`
and ` serif)`, neither of which trims to a bare generic.

**Defect 2 in the fix (P2) - FIXED in 24cc21e, COMPLETED in cdc9305.** `:where(pre, code, kbd)` (PR line 159) drops to
zero specificity UNCONDITIONALLY. The revert rule at PR lines 163-164
(`body *:not(pre, code, kbd, .code)...`) explicitly excludes pre/code/kbd, so
nothing else forces app monospace there. A book's `pre { font-family: X }`
(0,0,1) now beats it even with Override Book Font ON. `:where(html)` (PR line
127) kept its conditional `!important`; this rule did not. Fix:
`font-family: var(--monospace) ${overrideFont ? '!important' : ''};` alone is
NOT enough, and CodeRabbit caught the gap on the follow-up commit. `!important`
sorts a declaration above the non-important ones but does NOT exempt it from
the specificity tie-break: between two important author declarations the more
specific selector still wins, so a book's `pre { font-family: X !important }`
at (0,0,1) beat the `:where(...)` rule at (0,0,0) and Override Book Font
skipped that code block. Verified failing in Chromium, not just on the spec.
Shipped selector swaps sides with the toggle (plain `pre, code, kbd` would only
tie at (0,0,1) and win on order, losing to `body pre {!important}`):
```
${overrideFont ? 'html body :is(pre, code, kbd)' : ':where(pre, code, kbd)'} {
  font-family: var(--monospace) ${overrideFont ? '!important' : ''};
```
RULE: a specificity claim about this file has to be asserted on the RESOLVED
cascade, not the emitted selector text. The string assertion passed while the
behaviour was broken, because the rule carried `!important` and looked forcing.
`src/__tests__/utils/code-font-override.browser.test.ts` renders book CSS +
the reader stylesheet into an iframe in the paginator's injection order and
reads getComputedStyle; `paragraph-justify-text-wrap.browser.test.ts` is the
precedent to copy.

**`:where(html)` itself is sound.** It only changes books that declare
font-family on `html` (Pandoc EPUBs); `body` rules already beat inherited html
values regardless of specificity. Override-on is still covered by
`html body { font-family: ... !important }`. `:where()` is safe on the shipped
targets (iOS min 15, Android minSdk 26).

**Cosmetic - FIXED.** `style.test.ts` ~195-197 has a dangling comment fragment (the
"#5277" lead-in was deleted, leaving a sentence starting mid-thought), and the
`idempotence` suite is now vacuous since nothing is rewritten.

CodeRabbit reviewed and found nothing; the defects above were caught by reading
the cascade, not by any bot. Full suite after the fix: 10820 passed, lint and
format clean.

Related: [[css-style-fixes]]
