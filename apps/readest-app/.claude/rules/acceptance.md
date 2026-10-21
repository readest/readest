## Acceptance criteria

A change is merged only when it shows each of these. Say which were run and
what they printed, in the commit body or on the PR. A check that wasn't run is
listed as not run, never left out.

1. **A test that fails without the change**, for a change in behavior. Put
   the old code back and run the new test: it must fail on an assertion that
   names the behavior. A type error or a skipped test doesn't count. Say
   which test and what it failed with, then restore the change and see it
   pass. A change with no behavior to test (docs, config, agent files) says
   how it was checked instead.
2. **The checks in verification.md**, on the change merged onto current
   `origin/main`.
3. **Real use on the reporter's surface.** Reproduce the report in the app on
   their platform (desktop OS, Android, iOS, web, e-ink) with their kind of
   book, then see it fixed there (the `run` skill, CDP, Playwright). If that
   isn't possible, say so, and don't tell users it works.
4. **UI changes** hold under DESIGN.md: e-ink, dark mode, RTL, safe-area
   insets, and every new string through i18n.

A PR is merged only at the head that was reviewed:
`gh pr merge <N> --squash --match-head-commit <sha>`, after a comment saying
what was run at that sha. A test that fails on `main` is a bug to fix now, in
its own PR; "fails the same on main" is not a baseline.

Product decisions are the maintainer's. A change that reverses one (a
behavior, a layout, a default the maintainer chose) is left for the maintainer,
however good its reason.

A commit body says how it was verified and which test fails without it, and
credits the reporter by the public name they posted under (`Reported by
<their GitHub login> on GitHub`, or the handle on their public post), never
an email or account id. When a commit answers
the maintainer's feedback, its subject quotes it: `fix(reader): ... (owner: <their words>)`.

## Moved from LESSONS.md

Lessons seen on 3 or more days, checked on every review.

| Rule | What a reviewer looks at |
| --- | --- |
| One PR, one goal. | Unrelated fixes, features, refactors, dependency bumps and agent-memory updates go in PRs of their own. b3c671489 (#6624) bundled five changes; its Rename Group flattened nested groups, fixed 26 minutes later in 53b438055 (#6625). 2813ad7e6 (#6778, "fix:", 29 files) carried about 12 fixes and two features. c2809757f (#6751) carried a memory update. |
| Merge only the reviewed head, after the last review pass is answered, with a record of what ran. | Wait for CodeRabbit to finish and answer every finding, outside-diff ones included; a "Fixed in <sha>" reply names a commit that is on the PR head. 2ad87a0f6 (#6764) merged 3 minutes after a finding, and its "Fixed in f08019321" never reached main. 0409a6172 (#6720) merged 2 minutes after a review whose outside-diff finding shipped and needed #6721. On 10-04 to 10-09, 10 of 16 community PRs merged with no maintainer comment on what was run; #6686 cost two follow-ups. On 10-15, #6830, #6833, #6834 and #6835 merged with no maintainer comment and #6799 with an approval alone; the owner's #6813 and #6828 merged without the merge comment. |
| Check a UI change under every mode and form factor it ships to. | Use/Override Book Layout, light/dark, e-ink on/off, phone and tablet safe areas. d1a7a0435 (#6628): the Android e-ink widget forced black text on a card that follows dark mode. daa4b5197 (#6672) was checked in default layout only (#6711). 7893fa916 (#6674) was tried on iPad and BOOX; on iPhone its dock sat one safe-area inset high (2813ad7e6). Done right: a09e06913 (#6765) proved `getStyles` byte-identical to main across 72 combinations and changed only the 24 it targeted. |
