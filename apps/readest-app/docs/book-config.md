# Book Config JSON

Each imported book may have a per-book config file at:

```text
<bookHash>/config.json
```

The file is written under the `Books` storage root and uses the same camelCase
keys as the TypeScript `BookConfig` type in `src/types/book.ts`.

## Version

`schemaVersion` identifies the raw `config.json` schema written by Readest.
Current version:

```json
{
  "schemaVersion": 1
}
```

Configs written before this field existed are treated as legacy configs and are
loaded as the current version. New writes must include `schemaVersion`.

`schemaVersion` is only for the raw disk JSON file. The cloud sync
`book_configs` table is a normalized sync projection and does not mirror this
field.

## Stable Fields

Version 1 documents these fields as the supported integration surface:

- `schemaVersion`: raw config schema version.
- `bookHash`, `metaHash`: book identity when present.
- `progress`: current page tuple, `[current, total]`.
- `location`: current reading location as CFI.
- `xpointer`: current reading location as XPointer for KOReader interoperability.
- `booknotes`: bookmarks, annotations, and excerpts.
- `rsvpPosition`: RSVP reading position.
- `updatedAt`: last config update timestamp in milliseconds.

`viewSettings` and `searchConfig` are persisted app state. They are partial
overrides and are merged with defaults when Readest loads the config.

## Notes and XPointer Fields

`BookConfig.xpointer` is the current reading location. It was not renamed by
KOReader annotation sync work.

For notes in `booknotes`, Readest stores note ranges with:

- `xpointer0`: start XPointer.
- `xpointer1`: end XPointer, when available.

This distinction matters for integrations reading raw config files: progress
uses `xpointer`, while note ranges use `xpointer0` and `xpointer1`.
