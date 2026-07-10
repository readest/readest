__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

"""Background push worker: one QThread, sequential per-book processing."""

import io
import os
import shutil
import tempfile
import time
import traceback

from qt.core import QThread, pyqtSignal

from calibre_plugins.readest.api import (
    AuthRequiredError,
    QuotaExceededError,
    partial_md5,
    partial_md5_bytes,
)
from calibre_plugins.readest.wire import (
    EXTS,
    book_file_name,
    build_wire_book,
    cover_file_name,
    index_rows_by_uuid,
    merge_for_push,
    pick_format,
    pick_server_row,
    plan_push,
    tombstone_record,
)

STATUS_LABELS = {
    'uploaded': 'Uploaded',
    'replaced': 'Replaced',
    'updated': 'Updated',
    'skipped': 'Up to date',
    'failed': 'Failed',
}


def _jsonable(value):
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _custom_columns(mi):
    columns = {}
    for key in mi.custom_field_keys():
        try:
            value = mi.get(key)
        except Exception:
            continue
        if value in (None, '', []) or value == ():
            continue
        columns[key.lstrip('#')] = _jsonable(value)
    return columns


def _book_dict(mi, include_custom_columns, source_hash):
    pubdate = getattr(mi, 'pubdate', None)
    # calibre uses year-101 dates as "undefined".
    if pubdate is not None and getattr(pubdate, 'year', 0) < 1000:
        pubdate = None
    return {
        'title': mi.title,
        'authors': [a for a in (mi.authors or []) if a],
        'languages': list(mi.languages or []),
        'publisher': mi.publisher,
        'pubdate': pubdate.isoformat() if pubdate else None,
        'comments': mi.comments,
        'tags': sorted(mi.tags or []),
        'series': mi.series,
        'series_index': mi.series_index if mi.series else None,
        'uuid': getattr(mi, 'uuid', None),
        'isbn': (mi.get_identifiers() or {}).get('isbn'),
        'custom_columns': _custom_columns(mi) if include_custom_columns else None,
        'source_hash': source_hash,
    }


def _embed_metadata_copy(path, mi, fmt):
    """Copy the library file to a temp path and embed `mi` into it.

    The library file itself is never touched. Formats without a metadata
    writer (or a failing writer) fall back to the unmodified copy.
    """
    fd, tmp = tempfile.mkstemp(suffix='.' + EXTS[fmt], prefix='readest-')
    os.close(fd)
    shutil.copyfile(path, tmp)
    try:
        from calibre.ebooks.metadata.meta import set_metadata

        with open(tmp, 'r+b') as stream:
            set_metadata(stream, mi, EXTS[fmt])
    except Exception:
        traceback.print_exc()
    return tmp


class PushWorker(QThread):
    progress = pyqtSignal(int, int)  # done, total
    book_status = pyqtSignal(int, str, str)  # book_id, status key, detail
    done = pyqtSignal(bool, str)  # ok, message

    def __init__(self, parent, db, book_ids, client, include_custom_columns):
        QThread.__init__(self, parent)
        self.db = db  # calibre new_api (thread-safe)
        self.book_ids = list(book_ids)
        self.client = client
        self.include_custom_columns = include_custom_columns
        self.canceled = False

    def cancel(self):
        self.canceled = True

    def run(self):
        try:
            rows = [r for r in self.client.pull_books() if r.get('book_hash')]
            self.by_hash = {r['book_hash']: r for r in rows}
            self.by_uuid = index_rows_by_uuid(rows)
        except AuthRequiredError as err:
            self.done.emit(False, 'Please log in to Readest first. (%s)' % err)
            return
        except Exception as err:
            self.done.emit(False, 'Could not reach Readest: %s' % err)
            return

        counts = {}
        for index, book_id in enumerate(self.book_ids):
            if self.canceled:
                self.done.emit(False, 'Canceled.')
                return
            try:
                status, detail = self._push_one(book_id)
            except QuotaExceededError as err:
                self.book_status.emit(book_id, 'failed', str(err))
                self.done.emit(False, 'Readest storage quota exceeded — push stopped.')
                return
            except AuthRequiredError as err:
                self.book_status.emit(book_id, 'failed', str(err))
                self.done.emit(False, 'Session expired — please log in again.')
                return
            except Exception as err:
                traceback.print_exc()
                status, detail = 'failed', str(err)
            counts[status] = counts.get(status, 0) + 1
            self.book_status.emit(book_id, status, detail)
            self.progress.emit(index + 1, len(self.book_ids))

        summary = ', '.join(
            '%d %s' % (counts[key], STATUS_LABELS[key].lower())
            for key in ('uploaded', 'replaced', 'updated', 'skipped', 'failed')
            if key in counts
        )
        self.done.emit('failed' not in counts, summary or 'Nothing to push.')

    def _upload(self, file_name, fileobj, size, book_hash):
        upload = self.client.get_upload_url(file_name, size, book_hash)
        self.client.put_file(upload['uploadUrl'], fileobj, size)

    def _upload_cover(self, book_hash, cover_bytes):
        self._upload(cover_file_name(book_hash), io.BytesIO(cover_bytes), len(cover_bytes), book_hash)

    def _delete_cloud_files(self, book_hash):
        # Best-effort quota reclaim for a replaced book, mirroring the
        # koplugin's deleteCloudFiles: list to learn exact keys, then DELETE.
        try:
            for record in self.client.list_files(book_hash):
                if record.get('file_key'):
                    self.client.delete_file(record['file_key'])
        except Exception:
            traceback.print_exc()

    def _remember(self, record, uuid):
        # Keep the lookup maps current so a duplicate calibre entry later in
        # this run resolves to what we just pushed.
        row = {
            'book_hash': record['hash'],
            'title': record['title'],
            'author': record['author'],
            'tags': record.get('tags'),
            'metadata': record['metadata'],
            'uploaded_at': 'pushed',
            'cover_hash': record.get('coverHash'),
        }
        self.by_hash[record['hash']] = row
        if uuid:
            self.by_uuid[uuid] = row

    def _push_one(self, book_id):
        mi = self.db.get_metadata(book_id)
        fmt = pick_format(self.db.formats(book_id))
        if fmt is None:
            return 'failed', 'No Readest-supported format (EPUB, PDF, ...)'
        path = self.db.format_abspath(book_id, fmt)
        if not path or not os.path.exists(path):
            return 'failed', 'Book file is missing from the calibre library'

        source_hash = partial_md5(path)
        cover_bytes = self.db.cover(book_id)
        cover_hash = partial_md5_bytes(cover_bytes) if cover_bytes else None

        now_ms = int(time.time() * 1000)
        book = _book_dict(mi, self.include_custom_columns, source_hash)
        wire = build_wire_book(book, source_hash, fmt, now_ms)
        uuid = (book.get('uuid') or '').lower()
        server_row = pick_server_row(
            self.by_hash.get(source_hash), self.by_uuid.get(uuid) if uuid else None
        )
        plan = plan_push(server_row, wire, cover_hash, source_hash)

        if plan['action'] == 'skip':
            return 'skipped', ''

        if plan['action'] in ('new', 'replace'):
            blob_path = _embed_metadata_copy(path, mi, fmt)
            try:
                blob_hash = partial_md5(blob_path)
                wire['hash'] = wire['bookHash'] = blob_hash
                size = os.path.getsize(blob_path)
                with open(blob_path, 'rb') as f:
                    self._upload(book_file_name(blob_hash, fmt), f, size, blob_hash)
            finally:
                try:
                    os.unlink(blob_path)
                except OSError:
                    pass
            if plan['upload_cover'] and cover_bytes:
                self._upload_cover(blob_hash, cover_bytes)
            records = [
                merge_for_push(
                    wire,
                    server_row,
                    now_ms,
                    uploaded_at_ms=now_ms,
                    cover_hash=cover_hash if plan['upload_cover'] and cover_bytes else None,
                )
            ]
            replaced_hash = None
            if server_row is not None and server_row['book_hash'] != blob_hash:
                replaced_hash = server_row['book_hash']
                records.append(tombstone_record(server_row, now_ms))
            self.client.push_books(records)
            if replaced_hash:
                self._delete_cloud_files(replaced_hash)
            self._remember(records[0], uuid)
            return ('replaced' if plan['action'] == 'replace' else 'uploaded'), ''

        # action == 'update': the cloud file is current, only the row (and
        # possibly the cover) changed. Keep the row's hash namespace.
        wire['hash'] = wire['bookHash'] = server_row['book_hash']
        pushed_cover = plan['upload_cover'] and cover_bytes
        if pushed_cover:
            self._upload_cover(server_row['book_hash'], cover_bytes)
        record = merge_for_push(
            wire, server_row, now_ms, cover_hash=cover_hash if pushed_cover else None
        )
        self.client.push_books([record])
        self._remember(record, uuid)
        return 'updated', ''
