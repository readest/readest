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
records), `capture_ms`, `step_ms`, `settle_ms`, and `after` (run_all.sh starts both apps on a copy
of their homes from that scenario's run, as after a restart; by hand, set `PARITY_HOME`).

Each step is captured `capture_ms` after its input: the elements, the location and the screen at
that moment, in both apps. The next input comes `step_ms` after it. Keep captures away from the
times Readest's UI changes on its own: the link-target highlight goes after 4 s, the image
viewer's zoom badge 2 s after it opens, the Jump Return pill 15 s after the jump.

A step passes when the book location matches, no element moved more than 2 CSS px and no ink is
only in one app (`compare.py`). A scenario passes when every step passes or fails only for a known
difference (section 6). An uncaught script error in Lite's log (`js error`) fails the run; errors
the app caught and logged that name a script exception are listed in the report, often a web API
Lite lacks.

Run one scenario:

```sh
cd apps/readest-lite
node parity/run_cef.mjs parity/scenarios/S.json OUT/S-cef READEST_BIN
python3 parity/run_lite.py parity/scenarios/S.json OUT/S-lite LITE_BIN
python3 parity/compare.py OUT/S-lite OUT/S-cef OUT/S-report   # report.html, summary.json
```

Run them all (or the ones named) and print one line per scenario, with each failing step:
`parity/run_all.sh OUT READEST_BIN LITE_BIN [S...]`; `SKIP_CEF=1` reuses OUT's Readest runs.

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
| Page turns by tap zones, at Kindle size in e-ink | P1 | ✓ | reader-turns-eink |
| Page turns by swipe | P1 | ✓ | reader-turns-eink (`drag:`); quick-swipe wheel presses are device-only |
| Header and footer bars, their panels | P1 | ✓ | kindle-reader |
| Reading Progress panel: slider and page jump | P1 | ✓ | reader-progress |
| Table of Contents | P1 | ✓ | reader-toc |
| Search in the book | P2 | ✓ | reader-search |
| Add a bookmark | P2 | ✓ | reader-bookmark |
| Bookmark list, jump, remove | P2 | ○ | W1 |
| Re-open at the saved position | P1 | ✓ | reader-reopen |
| Footnote popup | P1 | ✓ | reader-links |
| Internal links and Jump Return | P2 | ✓ | reader-links |
| Image viewer | P2 | ✓ | reader-links |
| Table viewer | P3 | ○ | W3, features.epub |
| Scrolled mode | P2 | ○ | W2 |
| Vertical text (ja) | P2 | ✓ | format-vertical-ja (known difference) |
| Right-to-left book | P3 | ○ | W3, fixture book |
| PDF | P2 | ✓ | format-pdf (known difference) |
| FB2, CBZ, TXT | P2 | ✓ | format-fb2, format-cbz, format-txt |
| MOBI/AZW3 | P2 | ○ | W1 smoke, needs a fixture (no converter at hand) |
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
| Highlight style and color | P2 | ✓ | highlight-edit |
| Delete a highlight | P1 | ✓ | highlight-edit |
| Notebook: list, jump, edit a note | P2 | ◐ | kindle-reader opens it; W1 for the rest |
| Dictionary (Wiktionary) | P1 | ◐ | dictionary-de (known difference); dictionary-de-eink is L |
| Quick action on selection | P3 | ✓ | kindle-reader-tools (toggle) |
| Search from a selection | P3 | ○ | W2 |
| Proofread rules | P3 | ○ | W3 |

### Reader settings

| Feature | P | Status | Scenario / note |
| --- | --- | --- | --- |
| Font size | P1 | ✓ | reader-font-size |
| Page margins, line spacing | P1 | ✓ | reader-layout |
| Font face, weight, paragraph spacing, justify, hyphenate | P1 | ○ | W1, one step per control |
| Color themes (non e-ink) | P2 | ✓ | reader-theme (Sepia) |
| Dark mode | P2 | ○ | W2 |
| Override Book Layout / Color | P2 | ○ | W2 |
| Page-turn controls (tap zones, keys) | P3 | ○ | W3 |
| Keyboard: Tab through a dialog | P3 | ✓ | dialog-tab |
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
| Steps after `select:` | Lite shows the touch selection's handles (5 elements and their ink) | The harness selects by long press in Lite, by mouse in CEF | Harness (steps 1-2 of select-*, reader-note, highlight-*) |
| Go to Page input | Selected text is white on dark blue in Readest, black on light blue in Lite | Blitz's text input paints a fixed selection color and ignores `::selection` | Open (reader-progress step 5) |
| PDF | Doesn't open: "DOMMatrix is not defined" | pdf.js needs DOMMatrix, Path2D and a 2D canvas; Lite's canvas has no context | Open: owner's decision (large) |
| Vertical text (ja) | Laid out horizontally | Blitz has no vertical writing modes | Open: owner's decision (large) |
| Ids that name a document or form property (`target`, `title`, `action`...) | Readest drops them from a section, Lite keeps most: a link to one lands at its element in Lite, at the section start in Readest, and Lite's CFIs carry the id | Readest's DOMPurify drops an `id` that is `in document` or `in` a form; Lite's document and form lack 193 and 222 of Chromium's property names | Open: matching would mean every name; Readest's own behavior is the owner's to decide |
| Tables | A `<caption>` gets no layout and the table's box leaves it out (a table 51 px tall where Chromium's is 58 with a 7 px caption) | Blitz's table construction skips captions | Open: next, check whether its text shows at all |
| Tables, collapsed borders | The outer border takes the cells' width when the table's own is wider (a 40x30 table where Chromium's is 44x34) | Blitz's border-collapse resolution | Open |
| Steps after a tap | Readest's tapped element (or what replaced it there) keeps `:hover` | The harness clicks with a mouse that stays in CEF; Lite gets a finger | Harness: reader-links step 5's darker gray button passes the ink check |
| Comic and fixed-layout pages | Boxes in hidden page frames: Readest gives a `display: none` frame's document no boxes and a frame with no `src` an empty `about:blank` document; Lite lays out the first and gives the second no document | Blitz | Open, nothing visible (format-cbz, every step) |

## 7. Plan

Each new scenario runs on both apps, and every difference either becomes a Lite fix (a crate
test that fails without it, then the scenario) or a row in section 6. Fixes and scenarios are
separate commits.

**Harness**
- H2: scenario key `books` (several books in the library), for W2.
- H3: Done: `python3 parity/fixtures.py <books>/parity` writes features.epub (a footnote, an
  internal link, an image, a table), book.txt, book.fb2 and book.cbz, the same bytes on every run.
  Still to add: a right-to-left chapter, and MOBI from the EPUB if a converter is at hand.
- H4: steps that failed once in a full sweep and passed when rerun (2026-11-28), each something
  Lite hadn't drawn yet at the capture: kindle-reader step 6 (rb16, the Table of Contents list);
  reader-theme steps 3 and 5 (rb19 and rb20, the Color panel, load average ~17 from other
  sessions); reader-search step 6 (one run in three on rb19 and rb20, the results); dialog-tab
  step 2 (rb21, the Settings dialog); reader-links step 6 (a tap handled in 835 ms, so the image
  viewer's zoom badge was still up). Find whether Lite renders late under load or the capture is
  early.
- H5: Done: Lite's step image is the frame at the capture moment, as CEF's screenshot is. It was
  the last frame before the next input, so it could show what came later (reader-links step 3:
  the link-target highlight already gone).

**W1: daily reading on the Kindle (P1)**
1. Done: a line that ends a fraction of a pixel below the column now goes on in the next one, as
   in Chromium (reader-search step 7).
2. Done: `document.compatMode` is `CSS1Compat` (KaTeX warned at every start of quirks mode).
3. Done: tap-zone and swipe page turns at Kindle size in e-ink (reader-turns-eink).
4. Done: Reading Progress, the slider and a page jump (reader-progress).
5. Done: re-open at the saved position (reader-reopen, `after` reader-turns-eink).
6. Font & Layout: margins and line spacing done (reader-layout; a box under 2 px across a column
   cut now goes in the column that holds its middle, as in Chromium); the other controls.
7. Done: highlight style and color, delete a highlight (highlight-edit). Notebook list and jump,
   bookmark list and remove.
8. Done: footnote popup, internal link and Jump Return, image viewer (reader-links on
   features.epub): tables' `border` attribute, rows' rects, a link's hit area and the focus a
   link's destination takes now as in Readest.
9. Format smoke tests: TXT passes; FB2 now opens (XML documents); CBZ now opens and draws as in
   Readest (constructed stylesheets, an iframe's `load` after its images, scaled iframes drawn
   scaled, an absolute box before a lone image at the line's top), its remaining difference in
   hidden frames only. PDF and vertical text are section 6 rows for the owner; MOBI needs a
   fixture.

**W2: library and settings (P1/P2)**: several books (views, sort, search, a book's menu, select
mode, groups, progress), scrolled mode, dark mode, Override Book Layout/Color, UI language, a
highlight synced between the apps, sign in with email.

**W3: the rest (P3)**: table viewer, right-to-left, page-turn controls, custom CSS, auto-scroll,
paragraph mode, parallel read, proofread rules.
