# Readest Lite QA plan

Lite runs readest-app's own UI, so the reference for every screen and every behavior is Readest
desktop on Linux (CEF), built from the same readest-app. A difference is a Lite bug unless this
plan lists it as a known difference with its cause. What Lite leaves out on purpose is the commands
in `parity/commands-missing.json`; anything built on them is out of scope here (section 4).

## 1. Layers

| Layer | What it checks | How | When |
| --- | --- | --- | --- |
| Unit: engine | DOM shim, layout, paint, input | `cargo test -p blitz-qjs-script -p tauri-runtime-blitz` and `cargo test -p anyrender_cairo` from `apps/readest-lite` (never inside `vendor/`); `cargo test -p blitz-dom -p blitz-html` in a run of its own | Every Lite change: the crate it touches, with a test that fails without the change |
| Unit: runtime JS | `src/*.test.js` | `node --test apps/readest-lite/src/*.test.js` | When `src/` or the runtime's JS changes |
| Unit: app | readest-app changes made for Lite | `pnpm test --run <files>`, `pnpm lint` in readest-app | When readest-app changes |
| Commands | Every Tauri command Readest answers on Linux is answered by Lite or listed as missing | `parity/commands.py` (last step of `scripts/build-frontend.sh`) | Every frontend build |
| Screens | Each step of a scenario shows the same thing in both apps | `run_cef.mjs` + `run_lite.py` + `compare.py` (section 2) | Every scenario touched by a change; all of them after a rebase or a vendor bump |
| Behavior | Same data after the same actions: library, files, session, sync | `backend.py up` + `behavior.py` | Changes to sync, storage, fetch, start-up |
| Device | Touch input, e-ink paint, speed and memory on the Kindle | `lp.sh` scratch home, `drag.lua`/`tap.lua`, framebuffer captures, perf scripts (section 5) | Input, paint and performance changes; each build installed for the owner |

## 2. Screen parity: how a scenario passes

A scenario (`parity/scenarios/*.json`) is one book, a screen size and scale (Kindle Voyage: 536x724
at 2), e-ink or not, and steps:

| Step | Does |
| --- | --- |
| `wait:MS` | Waits (not captured) |
| `X,Y` | Taps at CSS px (CEF: mouse; Lite: finger) |
| `SELECTOR`, `text:Label` | Taps an element, or the element showing Label |
| `key:Name` | Presses a key |
| `type:Text` | Types into the focused field |
| `2x:X,Y` | Double tap |
| `hold:X,Y` | Finger held 700 ms (CEF can't select with it: no reference) |
| `select:X,Y>X2,Y2` | CEF: mouse drag; Lite: long press then drag |
| `drag:X,Y>X2,Y2` | A finger drag with no long press (a selection handle, a swipe) |

Scenario keys: `book`, `size`, `scale`, `eink`, `fonts`, `settings` (saved settings to start with),
`online` (hosts that bypass the closed proxy), `probe` (a script whose result each capture
records), `capture_ms`, `step_ms`, `settle_ms`.

A step passes when the book location matches, no element moved more than 2 CSS px and no ink is
only in one app (`compare.py`). A scenario passes when every step passes or fails only for a known
difference (section 6). Lite's `stderr.log` must also have no `js error` or `TypeError` lines:
`compare.py` doesn't check this yet (H1).

Run one scenario:

```sh
cd apps/readest-lite
node parity/run_cef.mjs parity/scenarios/S.json OUT/S-cef READEST_BIN
python3 parity/run_lite.py parity/scenarios/S.json OUT/S-lite LITE_BIN
python3 parity/compare.py OUT/S-lite OUT/S-cef OUT/S-report   # report.html, summary.json
grep -cE 'js error|TypeError' OUT/S-lite/stderr.log
```

READEST_BIN is a release build of this branch's readest-app with its own `CARGO_TARGET_DIR`
(restore the root `Cargo.lock` after it). Don't run a parity sweep while cargo builds: load makes
sections arrive late and steps fail.

## 3. Coverage

Priority: **P1** what a Kindle reader does every day, **P2** used often, **P3** rare. Status:
**✓** a scenario covers it, **◐** partly, **○** planned (section 7), **L** Lite-only check on the
device (no CEF reference), **–** out of scope (section 4).

### Library

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| Start on an empty library | P1 | ✓ | kindle-library |
| Open a book passed at launch, close it | P1 | ✓ | kindle-library-book |
| Import Books menu | P1 | ✓ | kindle-library-book |
| Import through the file picker | P1 | L | Lite's own picker (`src-tauri/src/picker.rs`); CEF shows GTK's |
| Book details | P2 | ✓ | kindle-library-book |
| Several books: grid and list views, sort, view menu | P1 | ○ | W2: needs a `books` list (H2) |
| Library search | P2 | ○ | W2 |
| A book's menu (long press): status, details, delete | P1 | ○ | W2 |
| Select mode and its actions | P2 | ○ | W2 |
| Groups and bookshelves | P2 | ◐ | kindle-library-book opens Bookshelves; W2 for the rest |
| Reading progress on a book | P2 | ○ | W2 |
| Settings tabs | P1 | ✓ | kindle-library |
| Advanced Settings, About, Reading Statistics | P2 | ✓ | kindle-library-book |

### Reading

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| Page turns by key | P1 | ✓ | novel-turns (1200x800) |
| Page turns by tap zones, at Kindle size in e-ink | P1 | ○ | W1 |
| Page turns by swipe | P1 | ○ | W1 (`drag:`); quick-swipe wheel presses are device-only |
| Header and footer bars, their panels | P1 | ✓ | kindle-reader |
| Reading Progress panel: slider and page jump | P1 | ◐ | kindle-reader opens it; W1 for moving |
| Table of Contents | P1 | ✓ | reader-toc |
| Search in the book | P2 | ✓ | reader-search |
| Add a bookmark | P2 | ✓ | reader-bookmark |
| Bookmark list, jump, remove | P2 | ○ | W1 |
| Re-open at the saved position | P1 | ○ | W1 (`PARITY_HOME` restart) |
| Footnote popup | P1 | ○ | W1, needs a fixture book (H3) |
| Internal links and Jump Return | P2 | ○ | W1, fixture book |
| Image viewer | P2 | ○ | W1 |
| Table viewer | P3 | ○ | W3, fixture book |
| Scrolled mode | P2 | ○ | W2 |
| Vertical text (ja) | P2 | ○ | W1 smoke: vertical-ja.epub |
| Right-to-left book | P3 | ○ | W3, fixture book |
| PDF | P2 | ○ | W1 smoke: text.pdf |
| MOBI/AZW3, FB2, CBZ, TXT | P2 | ○ | W1 smoke, fixture books |
| Speed Reading, Vocabulary, Reading Statistics panels | P3 | ✓ | kindle-reader-tools (open only) |
| Auto-scroll, paragraph mode, parallel read | P3 | ○ | W3 |

### Annotations

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| Select text (mouse drag; long press + drag) | P1 | ✓ | select-highlight(-eink) |
| Highlight | P1 | ✓ | select-highlight(-eink) |
| Edit a highlight's range with its handles | P1 | ✓ | highlight-extend-eink |
| A touch selection's own handles | P1 | L | Linux touch only (#7820); CEF can't make a touch selection |
| Note on a selection | P1 | ✓ | reader-note |
| Highlight style and color | P2 | ○ | W1 |
| Delete a highlight | P1 | ○ | W1 |
| Notebook: list, jump, edit a note | P2 | ◐ | kindle-reader opens it; W1 for the rest |
| Dictionary (Wiktionary) | P1 | ◐ | dictionary-de (known difference); dictionary-de-eink is L |
| Quick action on selection | P3 | ✓ | kindle-reader-tools (toggle) |
| Search from a selection | P3 | ○ | W2 |
| Proofread rules | P3 | ○ | W3 |

### Reader settings

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| Font size | P1 | ✓ | reader-font-size |
| Font face, weight, line and paragraph spacing, margins, justify, hyphenate | P1 | ○ | W1, one step per control |
| Color themes (non e-ink) | P2 | ✓ | reader-theme (Sepia) |
| Dark mode | P2 | ○ | W2 |
| Override Book Layout / Color | P2 | ○ | W2 |
| Page-turn controls (tap zones, keys) | P3 | ○ | W3 |
| UI language | P2 | ○ | W2 (CJK needs fonts in the scenario's `fonts`) |
| Custom CSS | P3 | ○ | W3 |

### Account and sync

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| First sync: books, covers, progress | P1 | ✓ | sync-first (behavior.py) |
| Restart on the same home | P1 | ✓ | sync-restart (behavior.py) |
| A highlight or note made in one app reaches the other | P1 | ○ | W2, behavior.py |
| Sign in with email in the UI | P2 | ○ | W2 (the harness signs in by token today) |

## 4. Out of scope

Built on commands Lite doesn't have (`parity/commands-missing.json`): OPDS, KOSync, WebDAV and the
other file-sync providers, translators, AI, Read Aloud (no TTS plugin), system clipboard (Copy),
share sheet, save dialogs (export annotations, Save As), backup and restore, import from a folder,
upload to Readest Cloud, LocalSend (BookDrop), the in-app browser and clipping, OAuth sign-in,
the updater, audiobooks, handwriting, widgets. For each, Lite must fail quietly: no `js error`,
no stuck spinner. Whether Lite gets any of them (`plugin:http` would bring the first six) is the
owner's decision.

## 5. Device QA (Kindle Voyage)

Run on each build installed for the owner, and after any input, paint or performance change. Never
while KOReader is open; close the owner's Lite only after 5 idle minutes and reopen it after.

| Check | How | Pass |
| --- | --- | --- |
| Build on the device | `md5sum bin/readest-lite` | Matches the stripped build |
| Book opens, spinner clean | `lp.sh start`, stream `/dev/fb0` during the open | No pixels beyond the arc (no box trace) |
| Page turns: tap and swipe | `tap.lua` at the side zones, `drag.lua` swipe | One page per input |
| Long press, handle drag, Highlight | `drag.lua X Y X Y 10 … 80`, `drag.lua` on the end handle, `tap.lua` Highlight | Range extends, highlight drawn |
| Scrolling a long menu | `drag.lua` in Advanced Settings | Scrolls, no tap fires |
| Taps near the top edge | `tap.lua` at y ≥ 50 | Header buttons respond |
| No idle repaints | Trace log while idle | No frames |
| JS errors | `grep -cE 'js error|TypeError' lp.log` and the owner's trace logs | 0 |
| Speed | `perfi.sh` (turns), `tapn.sh` (tap latency, 3000 ms gaps), re-open time | No regression against the installed build, in blocks, never alternating |
| Memory | `memrun.sh` re-open + 20 turns | RSS within the last build's |

## 6. Known differences (2026-11-28)

| Where | Difference | Cause | Status |
| --- | --- | --- | --- |
| About Readest | Version string | Different builds | Permanent |
| Reading Statistics | Reading-time bars | Depends on the run's date and time | Permanent |
| Speed Reading | The shown word | Timing | Permanent |
| Settings → Integrations | BookDrop "On" vs "Visible as Readest" | No LocalSend in Lite | Permanent |
| Highlight toolbar | The style button's "A" is 16 px tall vs 11.64 | `text-box: trim-both cap alphabetic` not supported in Blitz | Open (select-*, reader-note, highlight-extend steps 1-2, 4-5) |
| Dictionary popup | Superscript sense numbers | Blitz ignores `position: relative; top` on a non-atomic inline | Open |
| Text | Lite keeps slight hinting | Owner's decision (cairo) | Accepted |
| Search → result (reader-search step 7) | The next column starts 2 lines later in Readest | Lite keeps a line that ends 0.11 px below the column; Chromium moves it, and `widows: 2` then moves one more | Open: W1 |

## 7. Plan

Each new scenario runs on both apps, and every difference either becomes a Lite fix (a crate
test that fails without it, then the scenario) or a row in section 6. Fixes and scenarios are
separate commits.

**Harness**
- H1: `compare.py` reports Lite's `js error`/`TypeError` lines and fails on them.
- H2: scenario key `books` (several books in the library), for W2.
- H3: a fixture EPUB built by a script in `parity/` (footnotes, internal links, an image, a
  table, a right-to-left chapter), plus small FB2, TXT and CBZ fixtures; MOBI from the EPUB if a
  converter is at hand.
- H4: `parity/run_all.sh`: every scenario on both apps and one summary table.

**W1: daily reading on the Kindle (P1)**
1. Column fragmentation: a line that ends a fraction of a pixel below the column (reader-search
   step 7).
2. Tap-zone and swipe page turns at Kindle size in e-ink.
3. Reading Progress: drag the slider, jump to a page.
4. Re-open at the saved position.
5. Font & Layout: each control.
6. Highlight style and color, delete a highlight, Notebook list and jump, bookmark list and remove.
7. Footnote popup, internal link and Jump Return, image viewer (H3).
8. Format smoke tests: open and turn three pages in PDF, vertical-ja, FB2, TXT, CBZ, MOBI.

**W2: library and settings (P1/P2)**: several books (views, sort, search, a book's menu, select
mode, groups, progress), scrolled mode, dark mode, Override Book Layout/Color, UI language, a
highlight synced between the apps, sign in with email.

**W3: the rest (P3)**: table viewer, right-to-left, page-turn controls, custom CSS, auto-scroll,
paragraph mode, parallel read, proofread rules.
