# Readest calibre plugin

A [calibre](https://calibre-ebook.com) GUI plugin that pushes selected books —
with their metadata — into your [Readest](https://readest.com) cloud library.
Re-pushing a book updates its existing entry instead of creating a duplicate,
so you can edit metadata in calibre and re-send it any time.

Implements [readest/readest#4863](https://github.com/readest/readest/issues/4863).

## Features

- **Selective, manual push**: select books in calibre, click *Readest* in the
  toolbar. Nothing syncs in the background.
- **Metadata included and embedded**: title, authors, series, tags,
  description, publisher, language, identifiers — and optionally calibre
  custom columns. Metadata is written both to the Readest library entry
  (custom columns under `calibreColumns`) and into the uploaded file's OPF
  (calibre's own embedding, so custom columns travel as
  `calibre:user_metadata`). Your calibre library files are never modified —
  embedding happens on a temporary copy.
- **Update on re-push**: books already in your Readest library are recognized
  by their calibre uuid and only changed entries are rewritten; unchanged
  books are skipped, and a changed file replaces the old entry instead of
  duplicating it. Reading progress, grouping and reading status in Readest
  are preserved.
- **Per-book status report**: uploaded / updated / up to date / failed, with a
  storage-quota check (the push stops cleanly when your quota is exhausted).
- **Login like the apps**: email + password, or browser sign-in with Google,
  Apple, GitHub or Discord (OAuth via a temporary localhost callback, the same
  flow the desktop app uses).

## Install

Download `Readest-<version>.calibre-plugin.zip` from the
[latest release](https://github.com/readest/readest/releases/latest), or build
it yourself:

```sh
make zip                 # builds dist/Readest-<version>.calibre-plugin.zip
calibre-customize -a dist/Readest-*.calibre-plugin.zip   # or: make install
```

Or in calibre: *Preferences → Plugins → Load plugin from file*, then restart
calibre and add the *Readest* button to the main toolbar if it is not visible.

Release zips are versioned from `apps/readest-app/package.json` by the release
workflow, which stamps `PLUGIN_VERSION` in `__init__.py` before zipping; the
version committed in git is a development placeholder.

## Usage

1. Click the *Readest* toolbar button menu → *Log in to Readest…*
2. Select the books to push (any number).
3. Click the *Readest* button (or menu → *Push selected books to Readest*).

For each book the best Readest-supported format is pushed, preferring
`EPUB > PDF > AZW3 > MOBI > AZW > FB2 > FBZ > CBZ > TXT > MD`.

## How updates and duplicates work

At upload time the plugin embeds your current calibre metadata (including
custom columns) into a temporary copy of the book file, so the copy in your
Readest library is self-describing. Pushed books are then tracked by two keys:

- the **calibre book uuid**, carried in the entry's metadata
  (`urn:uuid:...`) — this recognizes "this calibre book is already in
  Readest" across pushes, even when the file bytes change;
- a **fingerprint of the raw calibre file** (`calibreSourceHash`), which
  detects whether the file itself changed since the last push — no local
  state, so it works from any machine.

Re-push behavior:

- **Nothing changed** → skipped.
- **Metadata edited** → the Readest library entry is updated in place; the
  file is not re-uploaded (its embedded OPF keeps the metadata from its
  upload time).
- **File changed** (e.g. re-converted) → the new file is uploaded with fresh
  embedded metadata and *replaces* the old entry: reading status, grouping,
  progress and the library date carry over, the old entry is removed and its
  cloud files are deleted. Notes and reading positions re-attach when
  title/authors are unchanged (Readest matches book versions by metadata
  identity).
- Books pushed by older plugin versions (or dragged into Readest manually)
  are recognized too: their entry hash doubles as the raw-file fingerprint.

## Development

Pure-logic modules (`api.py`, `wire.py`, `oauth.py`) have no calibre or Qt
dependencies and are covered by unit tests:

```sh
make test    # python3 -m unittest discover -s tests
```

### Translations

The plugin UI is localized with gettext: user-visible strings in the source
are wrapped in `_()` (singular) or `ngettext(singular, plural, n)` (plural),
and each module that uses them calls `load_translations()` at the top — that
is the hook calibre provides for plugins. calibre then picks the language
from *Preferences → Interface → Look & feel → Language* (or the
`CALIBRE_OVERRIDE_LANG` environment variable) and loads
`translations/<lang>.mo` from the plugin zip, falling back from e.g. `de_DE`
to `de`. English is the source language, so there is no `en` catalog.

Translations live in `translations/` as standard `.po` files (`readest.pot`
is the template); the compiled `.mo` files are committed alongside them so
`make zip` needs nothing but `zip`. After changing strings in the source:

```sh
make pot    # refresh translations/readest.pot from the source
# edit translations/*.po (or: python3 scripts/i18n.py new LANG for a new one)
make mo     # validate and compile every .po to its .mo
make test
```

`translations/` holds catalogs for German, Spanish, French, Italian, Japanese,
Korean, Polish, Portuguese (Portugal and Brazil), Russian, and Chinese
(Simplified, Traditional, and Hong Kong); other languages show the English
text. To try one without changing calibre's UI language:

```sh
CALIBRE_OVERRIDE_LANG=ja calibre
```

The wire protocol mirrors what the Readest apps and `readest.koplugin` use:
Supabase auth (`/auth/v1`), `GET/POST /api/sync` for library rows, and
`POST /api/storage/upload` + presigned PUT for file blobs.
