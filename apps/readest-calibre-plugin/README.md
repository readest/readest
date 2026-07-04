# Readest calibre plugin

A [calibre](https://calibre-ebook.com) GUI plugin that pushes selected books —
with their metadata — into your [Readest](https://readest.com) cloud library.
Re-pushing a book updates its existing entry instead of creating a duplicate,
so you can edit metadata in calibre and re-send it any time.

Implements [readest/readest#4863](https://github.com/readest/readest/issues/4863).

## Features

- **Selective, manual push**: select books in calibre, click *Readest* in the
  toolbar. Nothing syncs in the background.
- **Metadata included**: title, authors, series, tags, description, publisher,
  language, identifiers — and optionally calibre custom columns (stored under
  `customColumns` in the book's Readest metadata).
- **Update on re-push**: a book whose file is already in your Readest library
  is recognized (content hash) and only its metadata/cover entry is updated;
  unchanged books are skipped. Reading progress, notes, grouping and reading
  status in Readest are preserved.
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

Readest identifies a book by a partial MD5 hash of its file, so:

- Pushing the **same file** again never duplicates — the plugin compares your
  calibre metadata with the cloud entry and either updates it or skips it.
- **Metadata edits** in calibre don't change the file, so re-pushing only
  rewrites the library entry (no re-upload).
- **Changing the file itself** (e.g. re-converting the EPUB) produces a new
  hash, which Readest treats as a new book. Delete the old entry in Readest if
  you replace files.
- The uploaded file is the one stored in your calibre library, byte for byte;
  metadata is *not* embedded into the file (that would change its hash on
  every edit and defeat duplicate detection).

## Development

Pure-logic modules (`api.py`, `wire.py`, `oauth.py`) have no calibre or Qt
dependencies and are covered by unit tests:

```sh
make test    # python3 -m unittest discover -s tests
```

The wire protocol mirrors what the Readest apps and `readest.koplugin` use:
Supabase auth (`/auth/v1`), `GET/POST /api/sync` for library rows, and
`POST /api/storage/upload` + presigned PUT for file blobs.
