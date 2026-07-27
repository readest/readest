---
name: epub-undeclared-cover-entry-5273
description: "#5273 EPUB covers missing when cover.jpg is in the zip but absent from the OPF manifest; fixed by scanning container entry names in both foliate-js and the Rust importer"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0fb06272-bd58-479b-a4bc-bf7e157eb245
  modified: 2026-07-26T08:12:34.465Z
---

Issue #5273 ("fallback to images called cover") looked like a missing
heuristic, but both parsers *already* matched manifest hrefs containing
"cover" and even fell back to the first image in the manifest. The
reporter's Calibre sample had `cover.jpg` in the zip and
`<meta name="cover" content="cover"/>` in the OPF, yet **no manifest item
at all** — so every manifest-driven lookup was empty. Diagnosing this
needs the actual sample; reasoning from the OPF `<meta>` tag alone points
at the wrong layer.

Fix (2026-07-26): MERGED readest#5339 (`0e4272e4c`) + foliate#61
(`a3816a83`). When manifest resolution yields nothing, scan the
container's own entry names for one ending in `cover`/`couv` + an image
extension, mirroring `gnome-epub-thumbnailer`.

**Two parsers must move together.** EPUB cover resolution is duplicated:
- `packages/foliate-js/epub.js` — `EPUB.getCover()` (web import + reader);
  fix lives there, not in `Resources`, because only `EPUB` holds `entries`.
- `apps/readest-app/src-tauri/src/epub_parser.rs` — `resolve_cover_path`,
  used by `parse_epub_metadata` (Tauri import) and
  `extract_epub_cover_full`. Rust owns the cover on every native import,
  so a JS-only fix leaves desktop/mobile broken.
`src/__tests__/tauri/epub-parser-parity.tauri.test.ts` asserts cover
*presence* parity between the two, so divergent fallback rules break CI.

See [[calibre-plugin-push-4863]] for other Calibre-shaped EPUB quirks.
