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
- `blitz-paint` text: faux italics lean forward. The glyph skew is applied in y-down space,
  so its sign is negated; every synthesized italic used to slant backwards.

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
