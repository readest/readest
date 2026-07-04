__license__ = 'AGPL v3'
__copyright__ = '2026, The Readest Authors'

"""Background push worker: one QThread, sequential per-book processing."""

import io
import os
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
    book_file_name,
    build_wire_book,
    cover_file_name,
    merge_for_push,
    pick_format,
    plan_push,
)

STATUS_LABELS = {
    'uploaded': 'Uploaded',
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


def _book_dict(mi, include_custom_columns):
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
    }


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
            server_rows = {}
            for row in self.client.pull_books():
                if row.get('book_hash'):
                    server_rows[row['book_hash']] = row
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
                status, detail = self._push_one(book_id, server_rows)
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
            for key in ('uploaded', 'updated', 'skipped', 'failed')
            if key in counts
        )
        self.done.emit('failed' not in counts, summary or 'Nothing to push.')

    def _push_one(self, book_id, server_rows):
        mi = self.db.get_metadata(book_id)
        fmt = pick_format(self.db.formats(book_id))
        if fmt is None:
            return 'failed', 'No Readest-supported format (EPUB, PDF, ...)'
        path = self.db.format_abspath(book_id, fmt)
        if not path or not os.path.exists(path):
            return 'failed', 'Book file is missing from the calibre library'

        file_hash = partial_md5(path)
        cover_bytes = self.db.cover(book_id)
        cover_hash = partial_md5_bytes(cover_bytes) if cover_bytes else None

        now_ms = int(time.time() * 1000)
        wire = build_wire_book(_book_dict(mi, self.include_custom_columns), file_hash, fmt, now_ms)
        server_row = server_rows.get(file_hash)
        plan = plan_push(server_row, wire, cover_hash)

        if plan['action'] == 'skip':
            return 'skipped', ''

        uploaded_at_ms = None
        if plan['action'] in ('new', 'reupload'):
            size = os.path.getsize(path)
            upload = self.client.get_upload_url(book_file_name(file_hash, fmt), size, file_hash)
            with open(path, 'rb') as f:
                self.client.put_file(upload['uploadUrl'], f, size)
            uploaded_at_ms = now_ms

        pushed_cover_hash = None
        if plan['upload_cover'] and cover_bytes:
            upload = self.client.get_upload_url(
                cover_file_name(file_hash), len(cover_bytes), file_hash
            )
            self.client.put_file(upload['uploadUrl'], io.BytesIO(cover_bytes), len(cover_bytes))
            pushed_cover_hash = cover_hash

        record = merge_for_push(
            wire,
            server_row,
            now_ms,
            uploaded_at_ms=uploaded_at_ms,
            cover_hash=pushed_cover_hash,
        )
        response = self.client.push_books([record]) or {}

        # Keep the local map current so a duplicate file later in this run is
        # detected as already pushed. The response carries authoritative rows
        # in DB shape; fall back to a minimal synthetic row.
        authoritative = None
        for row in response.get('books') or []:
            if row.get('book_hash') == file_hash:
                authoritative = row
        server_rows[file_hash] = authoritative or {
            'book_hash': file_hash,
            'title': record['title'],
            'author': record['author'],
            'tags': record.get('tags'),
            'metadata': record['metadata'],
            'uploaded_at': 'pushed',
            'cover_hash': record.get('coverHash'),
        }

        return ('uploaded' if uploaded_at_ms else 'updated'), ''
