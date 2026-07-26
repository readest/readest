__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

"""Background push worker: one QThread, sequential per-book processing."""

import io
import os
import shutil
import tempfile
import time
import traceback
from collections import namedtuple

from qt.core import QThread, pyqtSignal

from calibre_plugins.readest.api import (
    AuthRequiredError,
    QuotaExceededError,
    partial_md5,
    partial_md5_bytes,
)
from calibre_plugins.readest.wire import (
    EXTS,
    PLAN_MARKS,
    book_file_name,
    build_wire_book,
    cloud_book_hashes,
    cover_file_name,
    index_rows_by_uuid,
    merge_for_push,
    ms_to_iso,
    pick_format,
    pick_server_row,
    plan_push,
    should_bulk_list,
    tombstone_record,
)

STATUS_LABELS = {
    'uploaded': 'Uploaded',
    'replaced': 'Replaced',
    'updated': 'Updated',
    'skipped': 'Up to date',
    'failed': 'Failed',
}
PUSH_ORDER = ('uploaded', 'replaced', 'updated', 'skipped', 'failed')

# A status check reports plan_push's actions verbatim, so its keys are the
# plan names rather than the past-tense push outcomes.
CHECK_LABELS = {
    'skip': 'In Readest',
    'update': 'Metadata differs',
    'replace': 'Out of date',
    'new': 'Not in Readest',
    'failed': 'Failed',
}
CHECK_ORDER = ('skip', 'update', 'replace', 'new', 'failed')

# Every push outcome except a failure leaves the book present in the cloud.
PUSHED_MARK = PLAN_MARKS['skip']

_BookPlan = namedtuple(
    '_BookPlan',
    'mi fmt path source_hash cover_bytes cover_hash now_ms wire uuid server_row plan',
)


def _lower_first(text):
    return text[:1].lower() + text[1:]


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


class _CloudWorker(QThread):
    """Pulls the cloud state once, then classifies each selected book.

    `PushWorker` acts on the plan; `StatusWorker` only reports it.
    """

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
        self.marks = {}  # book_id -> calibre mark label
        self.cloud_hashes = None  # whole-account listing, when it is worth paging
        self._blob_cache = {}  # book_hash -> in storage? (per-book fallback)

    def cancel(self):
        self.canceled = True

    def _load_cloud_state(self):
        """Server rows + storage listing. Returns an error message, or None."""
        try:
            rows = [r for r in self.client.pull_books() if r.get('book_hash')]
        except AuthRequiredError as err:
            return 'Please log in to Readest first. (%s)' % err
        except Exception as err:
            return 'Could not reach Readest: %s' % err
        self.by_hash = {r['book_hash']: r for r in rows}
        self.by_uuid = index_rows_by_uuid(rows)
        self.cloud_hashes = self._bulk_listing()
        return None

    def _bulk_listing(self):
        """Every book hash in storage, or None to look them up one at a time.

        Paging the whole listing costs a request per page whatever the
        selection size, so for a handful of books it is far cheaper to ask
        about just those. Page 1 tells us how long the listing is, and we need
        it anyway when we do go on to page the rest.
        """
        try:
            files, total_pages = self.client.list_files_page(1)
            if not should_bulk_list(total_pages, len(self.book_ids)):
                return None
            for page in range(2, total_pages + 1):
                if self.canceled:
                    return None
                more, _ = self.client.list_files_page(page)
                files.extend(more)
            return cloud_book_hashes(files)
        except Exception:
            # Fall back to per-book lookups, which degrade on their own.
            traceback.print_exc()
            return None

    def _blob_present(self, book_hash):
        """Whether this book's file is really in cloud storage."""
        if self.cloud_hashes is not None:
            return book_hash in self.cloud_hashes
        if book_hash not in self._blob_cache:
            try:
                self._blob_cache[book_hash] = book_hash in cloud_book_hashes(
                    self.client.list_files(book_hash)
                )
            except Exception:
                # Without an answer we can only trust uploaded_at, which is
                # what the plugin did before. The run goes on.
                traceback.print_exc()
                self._blob_cache[book_hash] = True
        return self._blob_cache[book_hash]

    def _plan_for(self, book_id):
        """(_BookPlan, '') for one book, or (None, reason) when it cannot be pushed."""
        mi = self.db.get_metadata(book_id)
        fmt = pick_format(self.db.formats(book_id))
        if fmt is None:
            return None, 'No Readest-supported format (EPUB, PDF, ...)'
        path = self.db.format_abspath(book_id, fmt)
        if not path or not os.path.exists(path):
            return None, 'Book file is missing from the calibre library'

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
        plan = plan_push(server_row, wire, cover_hash, source_hash, self._blob_present)
        return (
            _BookPlan(
                mi, fmt, path, source_hash, cover_bytes, cover_hash,
                now_ms, wire, uuid, server_row, plan,
            ),
            '',
        )

    def _summary(self, counts, labels, order, empty):
        parts = ', '.join(
            '%d %s' % (counts[key], _lower_first(labels[key])) for key in order if key in counts
        )
        return parts or empty


class PushWorker(_CloudWorker):
    def run(self):
        error = self._load_cloud_state()
        if error:
            self.done.emit(False, error)
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
            if status != 'failed':
                # Whatever the outcome, the book is now in the cloud, so keep
                # any marks a previous status check left from going stale.
                self.marks[book_id] = PUSHED_MARK
            self.book_status.emit(book_id, status, detail)
            self.progress.emit(index + 1, len(self.book_ids))

        self.done.emit(
            'failed' not in counts,
            self._summary(counts, STATUS_LABELS, PUSH_ORDER, 'Nothing to push.'),
        )

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
            'uploaded_at': ms_to_iso(record.get('uploadedAt')),
            'cover_hash': record.get('coverHash'),
        }
        self.by_hash[record['hash']] = row
        if uuid:
            self.by_uuid[uuid] = row
        # We just uploaded it, so don't go asking storage about it again.
        self._blob_cache[record['hash']] = True
        if self.cloud_hashes is not None:
            self.cloud_hashes.add(record['hash'])

    def _push_one(self, book_id):
        ctx, reason = self._plan_for(book_id)
        if ctx is None:
            return 'failed', reason

        mi, fmt, path = ctx.mi, ctx.fmt, ctx.path
        cover_bytes, cover_hash = ctx.cover_bytes, ctx.cover_hash
        now_ms, wire, uuid, server_row = ctx.now_ms, ctx.wire, ctx.uuid, ctx.server_row
        plan = ctx.plan

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


class StatusWorker(_CloudWorker):
    """Plans every selected book without uploading, and marks the results."""

    def run(self):
        error = self._load_cloud_state()
        if error:
            self.done.emit(False, error)
            return

        counts = {}
        for index, book_id in enumerate(self.book_ids):
            if self.canceled:
                self.done.emit(False, 'Canceled.')
                return
            try:
                ctx, reason = self._plan_for(book_id)
                status, detail = (ctx.plan['action'], '') if ctx else ('failed', reason)
            except Exception as err:
                traceback.print_exc()
                status, detail = 'failed', str(err)
            if status in PLAN_MARKS:
                self.marks[book_id] = PLAN_MARKS[status]
            counts[status] = counts.get(status, 0) + 1
            self.book_status.emit(book_id, status, detail)
            self.progress.emit(index + 1, len(self.book_ids))

        self.done.emit(
            'failed' not in counts,
            self._summary(counts, CHECK_LABELS, CHECK_ORDER, 'Nothing to check.'),
        )
