# Patches to upstream code

`scripts/vendor.sh` fetches each tree at the pinned version into `vendor/` and applies
`<tree>.diff`. Only these patches are committed. To change one, edit `vendor/`, then run
`scripts/vendor.sh diff`.

## blitz.diff (DioxusLabs/blitz f9d0e8c76, 0.3.0-beta.4)

- `Cargo.toml`: the workspace cut to the six packages Lite builds (`blitz-dom`, `blitz-html`,
  `blitz-paint`, `blitz-traits`, `stylo_taffy`, `debug_timer`).
- `<input placeholder>` is laid out and painted (`blitz-dom` layout/construct, damage, node/text;
  `blitz-paint` render): a second text editor holds the placeholder, drawn at half alpha while
  the input is empty. Readest's search box showed nothing without it.
- `blitz-dom` node/serialize: `currentColor` in inline SVG is serialized as `rgba()`, so SVG
  icons take their CSS colour instead of black.
- `blitz-paint` render/box_shadow: fully transparent inset shadows are skipped. daisyUI's
  depth-0 buttons have one, and drawing it as a hole erased the button's background.
- `blitz-dom` layout/paint_tree, `blitz-paint` render: a static box that clips its contents
  (`overflow` other than visible, `contain: paint`) no longer paints its positioned
  descendants itself. They paint at the positioned level of the nearest positioned ancestor,
  in tree order (CSS 2.1 Appendix E), clipped to the padding boxes of the clipping boxes they
  were lifted past (`lifted_clip_rect`). foliate-js's section views (`position: relative` in a
  static `overflow: hidden` container) were painted under its positioned white background.
- Columns on the root element (`blitz-dom` layout/columns, document, node, resolve, tree;
  `blitz-paint` render): CSS multi-column with a definite height, as foliate-js's paginator
  styles a section. The content is laid out once as one column; after layout it is cut into
  column slices at line boundaries, and paint, element rects, `scrollWidth`/`scrollHeight`
  and hit testing map between that flow and the columns. Turning a page lays out nothing.
  break-* properties are not honoured (Stylo parses them only for Gecko).
- `blitz-paint` render: clip rectangles (columns, lifted boxes) are in the painter's clip
  space, without its initial offset; in an iframe they were off by the iframe's position.
- `blitz-dom` node: `clip-path` clips hit testing (`inset()`, `polygon()` and reference
  boxes; other shapes do not yet). Readest clips full-page overlays down with `inset()`, so
  every tap on the page hit its top-inset strip.
- `blitz-dom` events/pointer: a finger or pen tap fires `mousedown` and `mouseup` before its
  `click`, as browsers' compatibility mouse events. Readest times a long hold from
  `mousedown`; without it every tap read as a hold.
- `blitz-dom` layout/inline/build, node/text, document: each inline layout records the byte
  range of its text that every text node became (`TextLayout::text_nodes`), and
  `BaseDocument::text_rects` gives the per-line boxes of part of a text node (DOM offsets
  mapped across collapsed white space, boxes from glyph-run clusters as element boxes are, in
  the root's columns): CSSOM View's Range rects, which foliate-js uses for the visible range,
  highlights and popups.
- `blitz-dom` node/svg, `blitz-paint` render: an SVG without a `viewBox` is not stretched (a
  user unit is a CSS px, scaled only by the device scale, as in browsers); usvg sizes such a
  tree to its content, and stretching that over the box moved every shape. foliate-js's
  Overlayer draws highlights in a CSS-sized `<svg>` with no viewBox.
- `blitz-dom` node/serialize: inside an inline SVG, an element's computed opacity and
  mix-blend-mode are written for usvg (the root's are painted as CSS; the blend mode joins
  the `style` attribute, the only place usvg reads it). Inline styles set by script are not
  attributes, and usvg can't read `var()`: Readest's highlights take both from CSS variables.
- `blitz-html` html_sink: `DocumentHtmlParser::parse_html_into_mutator` parses as HTML
  without sniffing for XHTML, as `DOMParser` does for `text/html` (readest-lite's
  `DOMParser` gives such documents to DOMPurify, which sanitizes every book section).
- `blitz-dom` resolve: a resolve with nothing to do (no dirty or damaged node, no stylesheet,
  device, animation or deferred change) skips style, layout and paint-tree work and only resolves
  the iframes. After a resolve the document node's dirty flag is cleared too: the style traversal
  starts below it and the damage pass returns before clearing it, so after any change that
  damaged nothing every later resolve redid all layout. foliate-js reads hundreds of element and
  range rects per page turn, each resolving first; a clean one went from 0.2–0.4 ms to under 10 µs.
- `blitz-html` html_sink: a fragment (`innerHTML`) is parsed under a detached root. html5ever
  appends the fragment's root to the document node, and a change to the document node's child
  list restyled every element once a selector had tested `:first-child` on the root element, as
  daisyUI's `:is(.stack, …) > :first-child` does. foliate-js clears its background layer with
  `innerHTML = ''` three times per page turn; each made the next rect query ~18 ms.
- `blitz-dom` document, mutator: `:has()` is parsed (`layout.css.has-selector.enabled`), and a
  change to an element's attributes, state or child list restyles the `:has()` anchors whose
  search reached it (from Stylo's search-direction and anchor selector flags; coarser than
  Gecko's dependency-based invalidation, never finer). Without the pref a selector list holding
  `:has()` was dropped whole, and Readest's book paragraph rule (`p, blockquote,
  div:not(:has(…))`) with it, so book text had `line-height: normal`.
- `blitz-dom` node, document, util: an inline element's box and a text range's rects span their
  font's content area (ascent above the baseline, descent below, each rounded to a whole pixel),
  as CSSOM View and browsers give, instead of the whole line box. foliate-js finds the visible
  range and places highlights from these rects.
- `blitz-dom` resolve: the root's columns are recomputed after every relayout. They were gated
  on the damage the root keeps, whose relayout bit damage propagation clears once it has dropped
  the layout cache, so after the first layout each section kept stale column cuts: a later
  restyle or viewport change moved the text but not the cuts, cutting lines in two and skipping
  columns.
- `blitz-dom` document, layout/columns: element rects as browsers give them. A scroll
  container's own box no longer moves with its scroll offset (foliate-js's paginator container
  reported its scrolled-away position). A box broken across the root's columns has one client
  rect per column, each reaching the column's bottom while the box goes on, as a fragmented
  block's fragments do; they stopped at the column cut and were merged into one. A box that ends
  under a pixel past a cut (its unrounded bottom against the next box's rounded top) does not
  go on: its rect ends at its own bottom.
- `blitz-dom` layout/inline/build, document, node/text: inline elements are recorded in
  `TextLayout::text_nodes` too, so an element with no glyphs (an empty span, such as an EPUB
  page-break marker) has a zero-width box where it sits instead of none. Beside an atomic inline
  inserted at its text offset (white space collapsed away around a page-break span before a
  full-page image), the box is at that inline's edge: the left of the first after it in tree
  order, else the right of the last before it. On a line with no text, its height is the
  content area of its own primary font, as Chromium's; it took the next text's position, or the
  whole line box. After a space that collapses into the text after it (`the <span/>carefully`),
  the box is after that space, at the next word, as in Chromium. When its inline root's lines
  hold nothing (only white space and empty inlines), its line box has no height and the element
  is a 0x0 box at the root's content start; it had no rect. Range rects walk each
  shaped run's clusters once: spans that change only the brush share one shaped run, which was
  walked again from every span's offset, shifting the rects of text after a span.
- `blitz-dom` layout/construct, layout/inline/build, document, node, stylo, traversal, damage,
  resolve: `::first-letter` (CSS Pseudo-Elements 4 §2.3). A block container whose own inline
  content starts with text gets an anonymous box after `::before` holding the first letter with
  the punctuation around it, styled by Stylo's eager `::first-letter` style; the text node is laid
  out with that box in the letter's place, so a floated one is a drop cap. Range rects of the
  letter's offsets are that box's when it is not inline. A block whose first line starts with
  `::before` content, or whose letter is in a descendant block, gets none.
- `blitz-dom` stylo_to_parley: text is shaped at the size Chromium on Linux gives FreeType, so
  lines break where Readest's do: floored to a hundredth of a pixel (Blink's font cache precision,
  `FontDescription::EffectiveFontSize`), then truncated to a 64th (Skia's `SkScalarToFDot6`).
  14.4px text was 0.065% wider than Readest's at the exact size; 8.672px text was 0.17% wider
  when truncated to a 64th alone. A unitless line height is passed as
  a length from the computed size, so line boxes keep their height.
- `blitz-paint` text: faux italics lean forward. The glyph skew is applied in y-down space,
  so its sign is negated; every synthesized italic used to slant backwards.
- `blitz-dom` layout/columns: a column ends early to honour `orphans` and `widows` (with
  stylo.diff): at least `widows` lines of a paragraph start the next column, and a paragraph that
  would leave fewer than `orphans` lines at a column's bottom moves to the next one; when both
  can't hold, orphans win, as in Chromium. Readest sets 2 for Latin text and 1 for CJK; a column ended
  at the first line that didn't fit, so pages differed from Readest's wherever a paragraph met a
  column's end.
- `blitz-dom` layout/columns: column metrics come from the root's unrounded layout. foliate-js
  gives the root a fractional side padding; from the rounded one each column was 0.42 px wider
  than Chromium's, and the error added up column by column.
- `blitz-dom` document: element and range rects include transforms (`border_box_to_document`:
  each box's location and transform up the containing-block chain, and the scroll offsets
  passed), as CSSOM View gives them. Readest's closed dialogs are scaled to 95%; their rects were
  the unscaled boxes.
- `blitz-dom` layout/sticky, resolve, scrolling, document: `position: sticky`. Taffy lays a
  sticky box out as a static one; after each resolve and each scroll its offset (its non-auto
  insets kept inside the nearest scroll container's padding box or the viewport, the box kept in
  its parent's content box) becomes a translation ahead of its transform, which paint, hit
  testing and rects read. Readest's dialog headers (`sticky top-1`) sat 4 px high.
- `blitz-dom` document, layout/inline/layout (with stylo.diff): `line-clamp` and the legacy
  `-webkit-line-clamp` (Tailwind's `line-clamp-N`) end a block's content box after that many
  lines; the `overflow: hidden` that comes with them clips the rest. Chromium honours the legacy
  property only in a `display: -webkit-box`; Blitz clamps any block, and draws no ellipsis yet.
- `blitz-dom` assets/default.css: a range input has Chromium's slider size (129 x 16, 2 px
  margin, no border or padding). It had no intrinsic size, so Readest's footer slider was 0 px
  tall. Blitz paints no slider.
- `blitz-dom` util, node, document: the space at a line's end has no box (CSS Text 3 removes it).
  Parley keeps it in the line's last glyph run and reports it as `hanging_advance`; an inline
  element's piece on that line and a range's rect stop where the line's content does, instead of
  reaching a space's width past the paragraph's edge. A range or line piece holding only that
  space has no rect, as in browsers; foliate-js bisects a page's visible range on it and ends the
  range before the space.
- `stylo_taffy` convert: an absolute length (padding, margin, width, `fit-content()`) is a whole
  number of 64ths of a pixel, truncated, as Chromium's `LayoutUnit`. foliate-js gives a section a
  fractional side padding (16.2105px); Lite kept it whole and its content box was 0.016 px
  narrower than Readest's, enough to wrap a line that fits there.
- `blitz-dom` mutator, document, node/element: a write that leaves the element as it was restyles
  nothing and asks for no repaint. That covers an attribute set to the value it has (an `src`
  set again still loads; a `style` attribute set again still replaces the declarations script
  changed), an absent attribute removed, and a style property set to its value or removed when
  absent (Stylo's `prepare_for_update`, as CSSOM's `setProperty`). foliate-js sets its views'
  `aria-hidden` several times a page turn, and each set made the next layout read lay the page
  out again.
- `blitz-traits` shell, `blitz-dom` mutator, resolve, document: a change to an attribute that
  reaches the screen only through selectors (`name`, `class`, `role`, `tabindex`, `title`,
  `aria-*`, `data-*`) asks the shell for a restyle (`ShellProvider::request_restyle`, which
  defaults to `request_redraw`), not a redraw, and `BaseDocument::damaged_by_last_resolve` says
  whether the next resolve damaged any node, subdocuments included. React 19 clears an input's
  `name` and sets it back on every update of the input; foliate-js sets its views' `aria-hidden`
  on every page turn and gives a section it loads classes, `tabindex` and `data-*` attributes.
  The runtime resolves such a page and paints it only if something was damaged.
- `blitz-dom` document, events/pointer: a hover change asks for a restyle, not a redraw (it
  reaches the screen only through `:hover` styles, or the devtools hover outline, which still
  redraws), and a press on text repaints only to remove a highlighted selection (the collapsed
  selection it starts draws nothing). A page turn on a Kindle is a tap on the book's text; each
  asked for two repaints of an unchanged frame, and the first one held back the pointer-up.
- `blitz-paint` render/border, kurbo_css/css_box: a border edge of width 0 draws nothing, and
  a rounded corner next to one splits at its limit angle (π/2) instead of ∞/∞. Tailwind's
  preflight gives every element `border: 0 solid`, so Blitz drew four empty edges per element;
  on Readest's rounded `html` and `body` the corner split was NaN, which put a NaN fill in every
  frame. A rounded box with one zero-width side drew its other edges washed out.

## stylo.diff (servo/stylo 2dca34592, 0.23.0)

Blitz's pin, all eleven crates of the repository (the root `Cargo.toml` patches each, so there is
one of each).

- `style` properties: `orphans` and `widows` are inherited Servo longhands (positive integers,
  initially 2). Stylo had them only as counted unknown properties, which drops the declarations.
- `style` properties: the `-webkit-line-clamp` shorthand is parsed for Servo too (it sets
  `line-clamp`, which Blitz enables with its pref).
- `style` values/specified/font: for Servo a computed font size under 1024 px is kept as computed,
  as Chromium keeps it, instead of snapped to a 60th of a pixel. Readest's `0.813em` body text is
  13.008px there and was 13px here, so every unitless line height built on it was 0.011 px short
  and lines drifted down the page.

## tauri.diff (readest/tauri d6ef6e4c7, feat/cef)

- `Cargo.toml`: the workspace cut to the seven crates Lite builds.
- `tauri` and `tauri-runtime`: GTK 3 is an optional, default-on `gtk` feature. Without it the
  runtime trait has no GTK types (`gtk_window`, `default_vbox`, `transient_for`) and menus
  keep their state without native widgets, so a runtime with no GTK can implement the trait.

## muda.diff (crates.io 0.19.3)

- A no-op Linux backend (`platform_impl/stub`) when the `gtk` feature is off, for Tauri's menu
  API without GTK.

## rquickjs-sys.diff (crates.io 0.10.0, with QuickJS-NG v0.18.0)

`vendor.sh` replaces rquickjs-sys's bundled QuickJS-NG 0.10.1 with v0.18.0's sources: 0.10.1
cannot compile one of Readest's script chunks.

- `build.rs`: compiles 0.18's file set (every header; there is no `cutils.c` any more).
  Bindings come from bindgen (blitz-qjs-script enables the feature).
- `src/inlines/ptr_64.rs`: 0.18 keeps ints and bools in the low half of the `uint64` value.

## rquickjs-core.diff (crates.io 0.10.0)

The 0.18 API:

- ArrayBuffer free callbacks are realloc-style.
- `JS_LoadModule` takes an attributes argument.
- The `concat` atom is gone.
- Rope strings (`JS_TAG_STRING_ROPE`) are strings.
