---
name: release-qa
description: >
  End-to-end QA of a release: list every user-facing change between the last
  release tag and main, run each one in the Linux Tauri (CEF) app and on an
  Android emulator, read the cause in the code for anything that fails, run a
  premium pass on a test account the maintainer signs into, and publish the
  results as an Artifact page with a shared manual checklist. Use with
  `/release-qa [<from-tag>] [<to-ref>]` before each release, or when asked to
  "QA the release", "verify everything since vX", or "check what users will see".
user_invocable: true
---

# Release QA

Unit and browser tests check code paths. This routine checks what a user meets:
each user-facing change since the last release, used in the running app the
way a reader would use it, with a screenshot for every claim. It ends with a
page the maintainer reads before shipping and a checklist of what only a human
or another platform can verify.

Helpers live next to this file. From the repo root:

```bash
Q=apps/readest-app/.claude/skills/release-qa
export QA_DIR=<scratchpad>/qa      # this run's work dir: results.md, shots/, logs/
mkdir -p "$QA_DIR/shots" "$QA_DIR/logs"
```

| File | Use |
| --- | --- |
| `build.sh <app-dir> <log-dir> [linux\|android\|all]` | Next build, CEF debug binary, Android x86_64 debug APK |
| `launch-linux.sh <binary> <fake-home> [cdp-port]` | isolated Linux launch (fake HOME, private D-Bus, stub portal, CDP) |
| `linux.mjs shot\|eval\|run` | Playwright over CDP to the Linux app (`QA_APP`, `CDP_PORT`, `PAGE_MATCH`) |
| `android.sh check\|fwd\|shot\|tap\|swipe\|key\|js` | adb + raw WebView CDP on your emulator (`ANDROID_SERIAL`, `DPR`) |
| `render_qa.py` + `qa.example.json` | results log → Artifact page |

## 0. Range

- `git fetch origin --tags`. Local tags go stale: a run once took v0.12.16 as
  the latest while v0.12.20 was already on origin. Read tags from
  `git ls-remote --tags origin 'v*'`.
- From = the argument, else the newest release tag. To = the argument, else
  `origin/main`. Record both and the short sha of To.

## 1. Inventory

- `git log --no-merges --format='%h %ad %s' --date=short FROM..TO > $QA_DIR/commits.txt`.
- Keep every `feat`/`fix`/`perf` a user can see or feel. Drop `test`, `ci`,
  `docs`, `chore` and refactors unless the body says behavior changed. Read the
  body of each kept commit: its Verification section says what was claimed and
  on which surface.
- Give each item one lane, with a reason:
  - **Linux**: anything the desktop app shows, plus shared reader/library UI.
  - **Android**: touch, page-turn animations, volume keys, system dictionary,
    Back, keyboard, e-ink, phone layouts, native plugins.
  - **Premium**: gated by `src/utils/access.ts` (`isAnkiAllowed`,
    `isCustomTranslatorAllowed`, `isCloudSyncAllowed`, ...) or needing an
    account (cloud books, cross-device sync).
  - **Manual**: iOS/iPadOS, macOS, Windows, web/PWA, Kindle (Lite), the
    KOReader plugin, server-only changes, real hardware (key hold, a BOOX,
    a current WebView), third-party services without a test account.
- Shared UI that ships to both apps runs on Linux first; repeat it on Android
  when layout, input or a mobile-only component is involved (the footer color
  panel, for one, exists only on mobile).

## 2. Build

- `pnpm worktree:new qa/<from>-<to-sha>` (never build in the shared main
  checkout). It starts from `origin/main`'s tip and installs that tip's
  dependencies, but copies `public/vendor` and `packages/simplecc-wasm/dist`
  from the main checkout's working files, which can be older even when To is
  the tip. Bring them all to To, in the worktree, in this order (steps 1-3
  only when To differs from the tip; 4 and 5 every time):
  1. `git reset --hard <to-sha>`.
  2. `git submodule update <path>` for each path `git submodule status`
     lists as initialized (no leading `-`). Never a bare `submodule update`:
     it clones the submodules the script skips.
  3. `pnpm install --frozen-lockfile`.
  4. `pnpm -C apps/readest-app setup-vendors` (it copies from foliate-js).
  5. If `git ls-tree <to-sha> packages/simplecc-wasm` names another commit
     than the main checkout's `git -C packages/simplecc-wasm rev-parse HEAD`,
     replace the copied `dist` with that commit's. Remove it first, since
     extracting over it keeps files the commit doesn't have: `rm -rf
     <worktree>/packages/simplecc-wasm/dist && git -C <main
     checkout>/packages/simplecc-wasm archive <commit> dist | tar -x -C
     <worktree>/packages/simplecc-wasm`.
- Check `git -C <worktree> rev-parse --short HEAD` is the recorded sha before
  building; results are for that sha only.
- Then, sandbox off, in the background:
  `$Q/build.sh <worktree>/apps/readest-app $QA_DIR/logs`. It exits nonzero
  when a build fails; never test a binary or APK left from an earlier build.
- Linux binary: `<worktree>/target/debug/readest`. APK:
  `apps/readest-app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/`.
- Android needs JDK 17 (the default 21 JRE has no javac). A shared
  `target/x86_64-linux-android` symlinked from main saves 20 minutes but can
  break (`can't find crate for ndk`); fall back to a private `CARGO_TARGET_DIR`.
- Afterwards restore any `gen/android` file the build rewrote.

## 3. Linux app

- `QA_DIR=$QA_DIR $Q/launch-linux.sh <binary> $HOME/dev/qa-home-<sha> 9231 &`
  with the sandbox off. Pick a CDP port nobody holds; the script refuses a busy
  one. Never reuse the maintainer's profile: a real HOME shares the signed-in
  session and syncs test data to their account.
- A fresh profile's first window can stay blank; reload it once over CDP.
- File dialogs answer from `$QA_DIR/answer.json` (`{"open": [paths],
  "saveDir": dir}`); every dialog, URL open and native prompt is logged to
  `$QA_DIR/portal.log`, so an opened link or a saved file is checkable there.
- Drive with `linux.mjs` (`QA_APP=<worktree>/apps/readest-app`): real clicks
  and keys through Playwright, `shot NAME` after each step.
- CDP key events skip Chrome's accelerators (Ctrl+W and the like). Don't press
  real keys on the live desktop; put those items on the manual list.

## 4. Android emulator

- Use an AVD of your own. `adb devices` and `ps aux | grep -- -avd` show what
  other sessions run; never touch their emulator or its port. A second AVD from
  the same image runs at another port: `emulator -avd <yours> -port 5556
  -no-snapshot-save -no-boot-anim -gpu host` (`-gpu host`: swiftshader crashed
  on imports).
- `adb install -r <apk>`, then `$Q/android.sh check` and confirm the install
  time: a run on the wrong build looks like a pass.
- `$Q/android.sh fwd` after every app start (the WebView pid changes), then
  `android.sh js '...'`. Host ports are shared by every emulator, and `fwd`
  refuses one forwarded for another device: set a `CDP_PORT` of your own.
  Playwright can't attach to the Android WebView; the helper speaks raw CDP.
  Taps and swipes take CSS px (`DPR` 2.625 on pixel_7).
- Pixel images ship WebView Chrome 124 and can't update it: keyboard and
  `visualViewport` behavior there is not a phone's. Put keyboard-layout
  results on the manual list for a real phone.
- E-ink start: `adb root; adb shell setprop ro.eink.support 1`; a reboot
  clears it. `adb root` once killed the emulator after a sleep/wake; restart it
  and carry on.

## 5. Run the checks

For each item: set up the state, act as a reader would, screenshot, write the
line, then the next item. Log as you go, in `$QA_DIR/results.md`:

```
[STATUS] Platform | #PR #PR | what was done -> what was seen
```

STATUS is `PASS`, `PASS?` (ran, but the evidence is thin; say why), `FAIL`
(the change doesn't do what it says), `ISSUE` (it works, but has a side effect
or rough edge), `NOTE` (worth a look; includes pre-existing bugs, marked
`pre-existing` with the commit that introduced them), `MANUAL`, `NOT RUN`,
`SKIP`. Name screenshots in the text (`shots/a-curl-mid.png`) to attach them.

Evidence rules:
- Prove a page turn by comparing screenshot hashes (`android.sh shot` prints
  one). The footer's "N / M" counter doesn't change on every screen; a run that
  trusted it called six good turns "missed".
- Re-check a miss before writing FAIL: confirm the setting's state in the DOM
  (a switch toggled twice is off), the right book is open, nothing is left open
  over the reader.
- Every FAIL and ISSUE gets its cause read in the code, with the file and the
  mechanism, after `Cause:` in the line. Look at later commits in the range:
  #7227 broke because #7254 merged a few hours after it.
- Check the commit message's claim against its code and tests; a mismatch is a
  NOTE even when the code is right.
- Never sign in, never solve a CAPTCHA, never commit from this routine.

## 6. Premium pass

1. Stop the Linux app and relaunch it with a new, empty fake HOME. On Android
   `adb shell pm clear com.bilingify.readest`, and reboot the emulator if a fake
   e-ink flag is set. Empty libraries keep the earlier test books out of the
   account.
2. Ask the maintainer to sign in on both apps with a premium **test** account.
   Never sign in yourself. On Linux, sign in with email and password: the
   `xdg-open` stub opens nothing, since an OAuth provider's `readest://`
   callback would reach an installed Readest in the real desktop session, not
   the isolated app.
3. Confirm the plan from the session JWT without printing identifiers:
   `linux.mjs eval` that decodes the access token's payload and returns only
   `plan` and `customization_purchased`.
4. For AI features add an OpenAI-compatible translator at the host's LAN IP,
   `http://<lan-ip>:11434/v1` (local Ollama). Settings sync carries it to the
   other device, and the emulator reaches the LAN IP where `localhost` would fail.
5. Use books already in the account. An import may upload to it.
6. Log these under a `## Premium (signed-in test account)` line in
   results.md; the page renders that section from it.

## 7. Page and report

- Copy `qa.example.json` to `$QA_DIR/qa.json` and set the range, date,
  environments, `evidence` (`contains` = a unique piece of a line, `shots` =
  files), `premium.planned` and the `checklist` (stable `id`s: they key the
  saved ticks).
- `python3 -I $Q/render_qa.py --results $QA_DIR/results.md --config
  $QA_DIR/qa.json --images $QA_DIR/shots --out $QA_DIR/page`. It warns about
  evidence that matched no line and images it couldn't find.
- Publish a new Artifact per release: `quickstart` first (the tool's rule), then
  publish `$QA_DIR/page/index.html` with `root` = `$QA_DIR/page`, `files` = every
  `shots/*.webp`, `capabilities: {"db": {}}`, icon `checklist`. Then one probe:
  `ArtifactData set` `checklist/probe`, `list` it at `as_level: view`, delete it.
- When fixes land after the run, add a section at the end of results.md:
  `## Fixed in #<PR> (merged <date> as <sha>)`, then one
  `[FIXED] #<PR> | <finding> (line N): <what changed, how it was checked>` per
  finding (line numbers of the original lines; say "unit tests only" and "not
  reproduced" when that's the case) and one `[OPEN] not fixed: ... (line N) ...`
  line. Re-render and republish: originals stay as written, with the fix or a
  Still open tag beside them.
- Later, read the maintainer's ticks and notes with `ArtifactData list`
  (collection `checklist`) and fold them into the next run. Re-render and
  publish the same file path to update the page as results come in.
- The final message, in this order: problems (FAIL, ISSUE, each with cause and
  PR), smaller notes, a short pass summary by area per platform, the manual
  list (platforms, premium/account, real device, partly checked, not run), what
  is still running and which settings were changed, the page URL, and the full
  absolute paths of results.md and shots/.
- Leave the worktree, fake homes and emulators in place, and say so; delete
  them only when asked.
