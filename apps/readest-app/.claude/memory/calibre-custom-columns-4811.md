---
name: calibre-custom-columns-4811
description: "Surface Calibre custom columns from OPF user metadata (#4811) - parse formats, calibreColumns field, details UI, library search"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7f74fc26-9614-4fe3-987b-66c8ce412523
---

Feature #4811 SHIPPED (app PR #4939 merged 2026-07-05 as `ec45a08`; foliate-js#47 merged as `8485e93`): surface Calibre custom columns embedded in EPUB OPFs. Worktree and branches cleaned up.

**Calibre OPF encodings (verified against calibre source opf2.py/opf3.py):**
- OPF2: one `<meta name="calibre:user_metadata:#label" content="{json}"/>` per column; label must start with `#`
- OPF3: a single `<meta property="calibre:user_metadata">{"#label": {...}}</meta>` (raw property attr always literally `calibre:user_metadata`; the `calibre:` prefix maps to `https://calibre-ebook.com` but foliate's URL-resolution concatenates without `:` so match the RAW attr, not the resolved one). Calibre prefers OPF3 over OPF2 when both present (`read_user_metadata3 || read_user_metadata2`).
- Value in `#value#` (array for multi-value), series index in `#extra#`; datetimes wrapped `{"__class__": "datetime.datetime", "__value__": "<ISO>"}`, unset date = `0101-01-01`; embedded files carry EVERY library column so empty values (null/''/[]/rating 0/undefined-date) must be dropped at parse time.

**Where things live:**
- Parser: `getCalibreUserMetadata` in foliate-js `epub.js`, attached AFTER `tidy()` (tidy would collapse single-element value arrays) as `metadata.calibreColumns` `[{label, name, datatype, value, extra?}]`
- Type: `CalibreCustomColumn` in `src/libs/document.ts`; `BookMetadata.calibreColumns`
- Formatter: `formatCalibreColumnValue` in `src/utils/book.ts` (rating → ★ half-stars /2, series → `Name [idx]`, bool → ✓/✗, comments → strip tags, datetime → formatDate)
- UI: extra grid cells in `BookDetailView.tsx` Metadata section after Identifier (column names are user content, NOT i18n keys)
- Search: `getCalibreColumnsText` in `src/app/library/utils/libraryUtils.ts` `createBookFilter` (both regex and substring branches)

**Why safe:** metaHash dedupe uses only title/authors/identifiers; metadata editor spreads `{...metadata}` so the field survives edits; import assigns `loadedBook.metadata` as-is. Calibre plugin pushes already embed user metadata via calibre `set_metadata`, so plugin-pushed books get columns through the same OPF parse (the plugin's flat `customColumns` wire field is a DIFFERENT shape and stays unused). E2E-verified on the real sample (Elena Sabe, OPF3, 11 columns → 7 shown, search "CT1" filters). Related: [[calibre-plugin-push-4863]].
