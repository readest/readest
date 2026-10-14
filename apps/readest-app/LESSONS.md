<!-- reviewed-through: 3cc39ad7a (2026-10-14 06:33 +0800) -->
# Lessons from merged work

Agents write, review and merge most of Readest's code. Each day the merged
commits are reviewed for what had to be fixed again, what shouldn't have
merged and what was verified too thinly (the `nightly-review` skill). What we
learned is kept here. Read this before changing code. Each lesson is a rule,
then the evidence. "Seen" counts the days a review found it. A lesson seen on
3 or more separate days moves into [acceptance](.claude/rules/acceptance.md).

From 2026-10-04 to 10-14 (86 commits, through v0.12.16), most fixes didn't need
a second try. The ones that did came from bundled PRs, checks listed but not
run, and a change verified in one mode or on one device. Three lessons were
seen on a third day and moved into the rules: one PR one goal, merge the
reviewed head with a record of what ran, and check a UI change under every
mode and form factor it ships to.

## Reading the report

**Reproduce on the reporter's OS and app version before calling a report
unreproducible or fixed.**
- Done right: bb55cda8b (#6770). The iOS share failed for the reporter but
  not on iOS 18.7/27.0; replaying the plugin on an iOS 16.4 simulator found
  `URL(string:)` returns nil for spaces and non-ASCII there. It fixed the
  Send, quote-card and image-share siblings too, and listed "not verified on
  an iOS 16 device".
- Done right: on #6773, the "still broken on 0.12.16" video turned out to be
  an older build once the version was checked.

## Fix the class, not the sample

**When you fix a behavior on one surface, find every surface with the same
mechanism and fix them together, or file them.**
- d69176a7a (#6642) kept the library's scroll position across opening a book.
  OPDS feeds had the same remount bug (#6673), fixed separately 5 days later
  in a39f46daf (#6683); Settings had its own fix in #6389. There are now three
  implementations.
- 2a1bef125 (#6711): #6672's CJK widow/orphan fix lived in a chunk skipped
  under Use Book Layout, so the page-bottom gap came back in that mode.
- 122d1dda3 (#6708): footnote popups ignored Full Justification off under
  Override Book Layout, while the reader respected it (#6636).
- Seen 2× (2026-10-04, 2026-10-09).

**When you tighten a validator or trust boundary, grep every caller and the
values it actually passes.**
- #6343 made `/api/kosync` reject server URLs with a path. BookOrbit passes
  `{server}/api/v1/koreader`, so its web progress sync returned 400 for about
  three weeks, as did sub-path KOSync servers. Fixed in c307cfd79 (#6698),
  which kept the allowlist and added mounted-path tests.
- Seen 1× (2026-10-10).

**Code that reads a section document survives a remount: the document can
briefly have no root.**
- 7893fa916 (#6674)'s ink re-anchor effect destructured
  `doc.documentElement`; during the sign-in detour it threw, reloaded the app
  and stopped Read Aloud. Fixed in e4af64912 (#6758), reproduced on an Android
  release build before and after.
- Seen 1× (2026-10-13).

## Dependencies and builds

**A PR that adds or bumps a dependency runs every build target before merge:
the Nix package (`pnpmDeps.hash`) and the web server build (`pnpm build-web`),
not only the PR's CI.**
- 44803443a (#6686) added `music-metadata` with 10 green checks. Main's Nix
  build then failed (`ERR_PNPM_NO_OFFLINE_TARBALL`, fixed in 3f45c2333,
  #6688) and the web server build failed on `strtok3` (fixed in 6025a29c8,
  #6699).
- Done right: 6025a29c8 (#6699) named the build it ran and checked no
  `strtok3` reference was left in the server chunks.
- Seen 1× (2026-10-09).

## Verification

**Run the real-use checks you list, and the failure, limit and scale paths of a
new feature, before merging. An unchecked box you could have run is not
done.**
- e51ca5ca0 (#6738) merged with "download the chapter being read…" unchecked.
  23 minutes later 2ea1a5328 (#6739) fixed two issues found testing it on
  production: a resumed download used Edge instead of the session's voice,
  and a failed start left a dead player open.
- 0409a6172 (#6720)'s test plan covered one successful chapter download.
  d2875c5ac (#6736) fixed what users met next day: progress frozen at 0/0,
  failed downloads that never retried, unexplained quota refusals, and a
  ~50 s wait before the first job on a long chapter.
- Seen 1× (2026-10-12).

**A full-suite failure that "passes when rerun alone" is a bug to file, not a
pass.**
- bb55cda8b (#6770) merged on "only load-induced 5s timeouts, and those files
  pass when rerun alone", with no issue naming the cause.
- Seen 1× (2026-10-13).

**List what wasn't run, plainly.**
- Done right: 53b438055 (#6625): "Not exercised on a device, to avoid
  renaming groups in a synced test library."
- Done right: a39f46daf (#6683) gives the failure without the fix
  (`expected +0 to be 4000`) and explains why #6642's approach can't work for
  `VirtuosoGrid`.

## Moved to the rules

Seen on three or more days; the rules and their evidence are in
[acceptance](.claude/rules/acceptance.md) and a review checks each one.

- **One PR, one goal** (10-04, 10-13, 10-14).
- **Merge only the reviewed head, after the last review pass is answered, with
  a record of what ran** (10-04, 10-08, 10-09, 10-11, 10-13).
- **Check a UI change under every mode and form factor it ships to** (10-05,
  10-09, 10-14).
