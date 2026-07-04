__license__ = 'AGPL v3'
__copyright__ = '2026, The Readest Authors'

"""Calibre metadata → Readest wire records, and per-book push planning.

Standard-library only (no calibre / Qt imports) so it can be unit-tested
outside calibre. The wire shape is the camelCase Book record consumed by
POST /api/sync (apps/readest-app/src/utils/transform.ts::transformBookToDB,
inverted — same as readest.koplugin's row_to_wire).
"""

import json
from datetime import datetime, timezone

try:  # inside calibre the plugin loads as a package
    from calibre_plugins.readest.api import meta_hash
except ImportError:  # plain imports for the unit tests
    from api import meta_hash

# Readest-supported formats, in upload preference order.
FORMAT_PRIORITY = ('EPUB', 'PDF', 'AZW3', 'MOBI', 'AZW', 'FB2', 'FBZ', 'CBZ', 'TXT', 'MD')

EXTS = {
    'EPUB': 'epub',
    'PDF': 'pdf',
    'MOBI': 'mobi',
    'AZW': 'azw',
    'AZW3': 'azw3',
    'CBZ': 'cbz',
    'FB2': 'fb2',
    'FBZ': 'fbz',
    'TXT': 'txt',
    'MD': 'md',
}

CLOUD_BOOKS_SUBDIR = 'Readest/Books'


def pick_format(available):
    """Best Readest-supported format among calibre's, or None."""
    upper = {f.upper() for f in available}
    for fmt in FORMAT_PRIORITY:
        if fmt in upper:
            return fmt
    return None


def book_file_name(file_hash, fmt):
    # Matches getRemoteBookFilename for S3 ({hash}/{hash}.{ext}); R2
    # deployments resolve it through the download API's hash+extension
    # fallback, same as the koplugin.
    return '%s/%s/%s.%s' % (CLOUD_BOOKS_SUBDIR, file_hash, file_hash, EXTS[fmt])


def cover_file_name(file_hash):
    return '%s/%s/cover.png' % (CLOUD_BOOKS_SUBDIR, file_hash)


def _clean(value):
    # The server strips NUL from strings (utils/sanitize.ts::sanitizeString);
    # strip locally too so pushed and pulled values compare equal.
    if isinstance(value, str):
        return value.replace('\x00', '')
    return value


def build_metadata(book):
    """BookMetadata JSON for the books row (libs/document.ts::BookMetadata).

    `book` is a plain dict extracted from calibre's Metadata object:
    title, authors, languages, publisher, pubdate, comments, tags, series,
    series_index, uuid, isbn, custom_columns.
    """
    authors = [_clean(a) for a in book.get('authors') or [] if a]
    meta = {
        'title': _clean(book.get('title')) or '',
        'author': authors[0] if len(authors) == 1 else authors,
    }
    languages = book.get('languages') or []
    if isinstance(languages, str):
        languages = [languages]
    if languages:
        meta['language'] = languages[0] if len(languages) == 1 else languages
    optional = {
        'publisher': _clean(book.get('publisher')),
        'published': _clean(book.get('pubdate')),
        'description': _clean(book.get('comments')),
        'subject': [_clean(t) for t in book.get('tags') or []] or None,
        'series': _clean(book.get('series')),
        'isbn': _clean(book.get('isbn')),
        # Partial MD5 of the RAW calibre library file. The uploaded blob has
        # metadata embedded so its hash (book_hash) shifts with every embed;
        # this stable fingerprint is how a later push detects "the file
        # itself changed" without any machine-local state.
        'calibreSourceHash': book.get('source_hash'),
    }
    if book.get('series'):
        optional['seriesIndex'] = book.get('series_index')
    if book.get('uuid'):
        optional['identifier'] = 'urn:uuid:%s' % book['uuid']
    if book.get('custom_columns'):
        optional['customColumns'] = book['custom_columns']
    for key, value in optional.items():
        if value not in (None, '', []):
            meta[key] = value
    return meta


def _author_string(book):
    return ', '.join(_clean(a) for a in book.get('authors') or [] if a)


def build_wire_book(book, file_hash, fmt, now_ms):
    """Base wire record for a calibre book (before server-row merging)."""
    identifiers = []
    if book.get('uuid'):
        identifiers.append('urn:uuid:%s' % book['uuid'])
    if book.get('isbn'):
        identifiers.append('isbn:%s' % book['isbn'])
    title = _clean(book.get('title')) or ''
    authors = [_clean(a) for a in book.get('authors') or [] if a]
    return {
        'hash': file_hash,
        'bookHash': file_hash,
        'metaHash': meta_hash(title, authors, identifiers),
        'format': fmt,
        'title': title,
        'sourceTitle': title,
        'author': _author_string(book),
        'tags': [_clean(t) for t in book.get('tags') or []],
        'metadata': build_metadata(book),
        'createdAt': now_ms,
        'updatedAt': now_ms,
    }


def iso_to_ms(iso):
    if not iso:
        return None
    text = iso.replace('Z', '+00:00')
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _parse_row_metadata(row):
    raw = row.get('metadata')
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return json.loads(raw)
        except ValueError:
            return None
    return None


def _row_matches_wire(row, wire):
    if (row.get('title') or '') != wire['title']:
        return False
    if (row.get('author') or '') != wire['author']:
        return False
    if (row.get('tags') or []) != (wire.get('tags') or []):
        return False
    return _parse_row_metadata(row) == wire['metadata']


def row_source_hash(row):
    """The raw-file fingerprint a server row was built from.

    v2 rows carry it as metadata.calibreSourceHash; v1 rows uploaded the raw
    file unmodified, so their book_hash IS the raw hash.
    """
    meta = _parse_row_metadata(row) or {}
    return meta.get('calibreSourceHash') or row.get('book_hash')


def metadata_uuid(meta):
    """Calibre book uuid from a metadata dict's urn:uuid identifier."""
    identifier = (meta or {}).get('identifier')
    if isinstance(identifier, str) and 'urn:uuid:' in identifier:
        return identifier.rsplit(':', 1)[-1].lower()
    return None


def _prefer_row(row, over):
    row_live, over_live = not row.get('deleted_at'), not over.get('deleted_at')
    if row_live != over_live:
        return row_live
    return (iso_to_ms(row.get('updated_at')) or 0) > (iso_to_ms(over.get('updated_at')) or 0)


def index_rows_by_uuid(rows):
    """Map calibre uuid -> best server row (live over tombstoned, then newest).

    This is the identity that survives file-content changes: the uploaded blob
    has metadata embedded, so book_hash shifts whenever the file or its
    metadata does, but the calibre uuid in metadata.identifier stays put.
    """
    best = {}
    for row in rows:
        uuid = metadata_uuid(_parse_row_metadata(row))
        if not uuid:
            continue
        current = best.get(uuid)
        if current is None or _prefer_row(row, current):
            best[uuid] = row
    return best


def pick_server_row(hash_row, uuid_row):
    """Choose the row a push should target: live hash match, then live uuid
    match, then whatever tombstone is left (for resurrection)."""
    for row in (hash_row, uuid_row):
        if row is not None and not row.get('deleted_at'):
            return row
    return hash_row if hash_row is not None else uuid_row


def plan_push(server_row, wire, local_cover_hash, source_hash):
    """Decide what to do for one book.

    Returns {'action': 'new' | 'replace' | 'update' | 'skip',
             'upload_cover': bool}.
    - new:     no server row — embed metadata, upload file, insert row
    - replace: the raw file changed (or the row has no file blob) — upload a
               fresh embedded blob under its new hash, tombstone the old row
    - update:  file unchanged, but metadata/cover/tombstone differ — row only
    - skip:    file + metadata + cover all unchanged
    """
    if server_row is None:
        return {'action': 'new', 'upload_cover': bool(local_cover_hash)}
    if not server_row.get('uploaded_at') or row_source_hash(server_row) != source_hash:
        # A replaced book gets a new hash namespace, so it needs its own cover.
        return {'action': 'replace', 'upload_cover': bool(local_cover_hash)}
    cover_changed = bool(local_cover_hash) and local_cover_hash != server_row.get('cover_hash')
    changed = (
        not _row_matches_wire(server_row, wire)
        or bool(server_row.get('deleted_at'))
        or cover_changed
    )
    return {'action': 'update' if changed else 'skip', 'upload_cover': cover_changed}


def tombstone_record(row, now_ms):
    """Wire record that soft-deletes a replaced server row."""
    return {
        'hash': row['book_hash'],
        'bookHash': row['book_hash'],
        'metaHash': row.get('meta_hash'),
        'format': row.get('format'),
        'title': row.get('title') or '',
        'author': row.get('author') or '',
        'createdAt': iso_to_ms(row.get('created_at')) or now_ms,
        'updatedAt': now_ms,
        'deletedAt': now_ms,
    }


def merge_for_push(wire, server_row, now_ms, uploaded_at_ms=None, cover_hash=None):
    """Final record for POST /sync.

    The server explicit-nulls any field absent from the wire record
    (transformBookToDB), so an update must carry over the server row's
    groupId/groupName, progress, readingStatus, uploadedAt and cover fields —
    the koplugin learned this the hard way (see syncbooks.lua:291-299).
    """
    record = dict(wire)
    record['updatedAt'] = now_ms
    record['deletedAt'] = None  # an explicit push (re)activates the book
    row = server_row or {}
    record['createdAt'] = iso_to_ms(row.get('created_at')) or wire['createdAt']
    if row.get('group_id'):
        record['groupId'] = row['group_id']
    if row.get('group_name'):
        record['groupName'] = row['group_name']
    if row.get('progress') is not None:
        record['progress'] = row['progress']
    if row.get('reading_status'):
        record['readingStatus'] = row['reading_status']
        record['readingStatusUpdatedAt'] = iso_to_ms(row.get('reading_status_updated_at'))
    record['uploadedAt'] = (
        uploaded_at_ms if uploaded_at_ms is not None else iso_to_ms(row.get('uploaded_at'))
    )
    if cover_hash:
        record['coverHash'] = cover_hash
        record['coverUpdatedAt'] = now_ms
    elif row.get('cover_hash'):
        record['coverHash'] = row['cover_hash']
        record['coverUpdatedAt'] = iso_to_ms(row.get('cover_updated_at'))
    return record
