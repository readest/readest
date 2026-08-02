import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from wire import (  # noqa: E402
    MARK_PREFIX,
    PLAN_MARKS,
    book_file_name,
    build_metadata,
    build_wire_book,
    cloud_book_hashes,
    cover_file_name,
    index_rows_by_uuid,
    iso_to_ms,
    merge_for_push,
    merge_marks,
    ms_to_iso,
    pick_format,
    pick_server_row,
    plan_push,
    should_bulk_list,
    tombstone_record,
)

NOW = 1_800_000_000_000
SRC = 's' * 32  # partial MD5 of the raw calibre library file

BOOK = {
    'title': 'The Test Book',
    'authors': ['Alice Author', 'Bob Writer'],
    'languages': ['eng'],
    'publisher': 'Test House',
    'pubdate': '2020-05-01T00:00:00+00:00',
    'comments': '<p>A very good book.</p>',
    'tags': ['Fiction', 'Test'],
    'series': 'Test Series',
    'series_index': 2.0,
    'uuid': 'cafebabe-0000-0000-0000-000000000001',
    'isbn': '9781234567897',
    'custom_columns': {'read_status': 'done'},
    'source_hash': SRC,
}


def server_row(**overrides):
    row = {
        'book_hash': 'a' * 32,
        'meta_hash': 'b' * 32,
        'format': 'EPUB',
        'title': 'The Test Book',
        'author': 'Alice Author, Bob Writer',
        'tags': ['Fiction', 'Test'],
        'group_id': 'g1',
        'group_name': 'Group One',
        'progress': [3, 100],
        'reading_status': 'reading',
        'reading_status_updated_at': '2024-01-02T00:00:00.000Z',
        'cover_hash': 'c' * 32,
        'cover_updated_at': '2024-01-02T00:00:00.000Z',
        'metadata': None,
        'created_at': '2024-01-01T00:00:00.000Z',
        'updated_at': '2024-01-02T00:00:00.000Z',
        'deleted_at': None,
        'uploaded_at': '2024-01-01T12:00:00.000Z',
    }
    row.update(overrides)
    return row


def wire_for(book=BOOK, file_hash='a' * 32, fmt='EPUB', now=NOW):
    return build_wire_book(book, file_hash, fmt, now)


def synced_row(wire):
    """A server row that matches `wire` (as if we pushed it earlier)."""
    return server_row(
        title=wire['title'],
        author=wire['author'],
        tags=wire.get('tags'),
        metadata=json.dumps(wire['metadata']),
    )


class PickFormatTest(unittest.TestCase):
    def test_prefers_epub(self):
        self.assertEqual(pick_format(['MOBI', 'EPUB', 'PDF']), 'EPUB')

    def test_case_insensitive(self):
        self.assertEqual(pick_format(['azw3', 'txt']), 'AZW3')

    def test_unsupported_only(self):
        self.assertIsNone(pick_format(['DOCX', 'LRF']))

    def test_empty(self):
        self.assertIsNone(pick_format([]))


class BuildMetadataTest(unittest.TestCase):
    def test_fields(self):
        meta = build_metadata(BOOK)
        self.assertEqual(meta['title'], 'The Test Book')
        self.assertEqual(meta['author'], ['Alice Author', 'Bob Writer'])
        self.assertEqual(meta['language'], 'eng')
        self.assertEqual(meta['publisher'], 'Test House')
        self.assertEqual(meta['published'], '2020-05-01T00:00:00+00:00')
        self.assertEqual(meta['description'], '<p>A very good book.</p>')
        self.assertEqual(meta['subject'], ['Fiction', 'Test'])
        self.assertEqual(meta['series'], 'Test Series')
        self.assertEqual(meta['seriesIndex'], 2.0)
        self.assertEqual(meta['identifier'], 'urn:uuid:cafebabe-0000-0000-0000-000000000001')
        self.assertEqual(meta['isbn'], '9781234567897')
        self.assertEqual(meta['customColumns'], {'read_status': 'done'})
        self.assertEqual(meta['calibreSourceHash'], SRC)

    def test_single_author_is_string(self):
        meta = build_metadata(dict(BOOK, authors=['Solo']))
        self.assertEqual(meta['author'], 'Solo')

    def test_omits_empty_fields(self):
        meta = build_metadata({'title': 'T', 'authors': []})
        self.assertNotIn('publisher', meta)
        self.assertNotIn('series', meta)
        self.assertNotIn('customColumns', meta)
        self.assertNotIn('isbn', meta)
        self.assertNotIn('calibreSourceHash', meta)

    def test_strips_nul_characters(self):
        meta = build_metadata({'title': 'T\x00itle', 'authors': ['A\x00nn']})
        self.assertEqual(meta['title'], 'Title')
        self.assertEqual(meta['author'], 'Ann')


class BuildWireBookTest(unittest.TestCase):
    def test_record_shape(self):
        wire = wire_for()
        self.assertEqual(wire['hash'], 'a' * 32)
        self.assertEqual(wire['bookHash'], 'a' * 32)
        self.assertEqual(wire['format'], 'EPUB')
        self.assertEqual(wire['title'], 'The Test Book')
        self.assertEqual(wire['sourceTitle'], 'The Test Book')
        self.assertEqual(wire['author'], 'Alice Author, Bob Writer')
        self.assertEqual(wire['tags'], ['Fiction', 'Test'])
        self.assertEqual(wire['createdAt'], NOW)
        self.assertEqual(wire['updatedAt'], NOW)
        self.assertEqual(len(wire['metaHash']), 32)
        self.assertEqual(wire['metadata']['title'], 'The Test Book')

    def test_meta_hash_uses_uuid_identifier(self):
        import hashlib
        import unicodedata

        wire = wire_for()
        source = 'The Test Book|Alice Author,Bob Writer|cafebabe-0000-0000-0000-000000000001'
        expected = hashlib.md5(unicodedata.normalize('NFC', source).encode('utf-8')).hexdigest()
        self.assertEqual(wire['metaHash'], expected)


class IsoToMsTest(unittest.TestCase):
    def test_iso_with_ms(self):
        self.assertEqual(iso_to_ms('2024-01-01T00:00:00.000Z'), 1704067200000)

    def test_iso_without_ms(self):
        self.assertEqual(iso_to_ms('2024-01-01T00:00:00Z'), 1704067200000)

    def test_none(self):
        self.assertIsNone(iso_to_ms(None))


class PlanPushTest(unittest.TestCase):
    def test_new_book(self):
        plan = plan_push(None, wire_for(), 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'new')
        self.assertTrue(plan['upload_cover'])

    def test_new_book_without_cover(self):
        plan = plan_push(None, wire_for(), None, SRC)
        self.assertEqual(plan['action'], 'new')
        self.assertFalse(plan['upload_cover'])

    def test_unchanged_book_is_skipped(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'skip')

    def test_changed_metadata_is_update(self):
        wire = wire_for(dict(BOOK, title='Renamed Title'))
        row = synced_row(wire_for())
        plan = plan_push(row, wire, 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'update')
        self.assertFalse(plan['upload_cover'])

    def test_changed_cover_only_is_update_with_cover(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, 'd' * 32, SRC)
        self.assertEqual(plan['action'], 'update')
        self.assertTrue(plan['upload_cover'])

    def test_tombstoned_row_is_resurrected(self):
        wire = wire_for()
        row = synced_row(wire)
        row['deleted_at'] = '2024-06-01T00:00:00.000Z'
        plan = plan_push(row, wire, 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'update')

    def test_tags_change_is_update(self):
        wire = wire_for(dict(BOOK, tags=['Fiction']))
        row = synced_row(wire_for())
        self.assertEqual(plan_push(row, wire, 'c' * 32, SRC)['action'], 'update')

    def test_missing_local_cover_does_not_force_update(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, None, SRC)
        self.assertEqual(plan['action'], 'skip')

    def test_row_without_file_is_replaced(self):
        wire = wire_for()
        row = synced_row(wire)
        row['uploaded_at'] = None
        plan = plan_push(row, wire, 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'replace')
        self.assertTrue(plan['upload_cover'])  # new hash namespace needs its own cover

    def test_changed_source_file_is_replaced(self):
        wire = wire_for(dict(BOOK, source_hash='n' * 32))
        row = synced_row(wire_for())  # cloud copy built from SRC
        plan = plan_push(row, wire, 'c' * 32, 'n' * 32)
        self.assertEqual(plan['action'], 'replace')

    def test_v1_row_with_matching_raw_hash_is_not_replaced(self):
        # v1 rows have no calibreSourceHash but their book_hash IS the raw
        # file hash (v1 uploaded the file unmodified).
        book = dict(BOOK)
        del book['source_hash']
        v1_wire = wire_for(book)
        row = synced_row(v1_wire)
        row['book_hash'] = SRC
        plan = plan_push(row, wire_for(), 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'update')  # gains calibreSourceHash

    def test_v1_row_with_changed_file_is_replaced(self):
        book = dict(BOOK)
        del book['source_hash']
        row = synced_row(wire_for(book))
        row['book_hash'] = 'o' * 32  # raw hash of the OLD file
        plan = plan_push(row, wire_for(), 'c' * 32, SRC)
        self.assertEqual(plan['action'], 'replace')

    def test_missing_blob_is_replaced_even_when_row_claims_upload(self):
        # "Manage Storage" deletes the object and its files row but leaves
        # books.uploaded_at set, so the row alone cannot prove the blob exists.
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, 'c' * 32, SRC, blob_present=False)
        self.assertEqual(plan['action'], 'replace')
        self.assertTrue(plan['upload_cover'])

    def test_missing_blob_on_tombstoned_row_is_replaced(self):
        # Deleting a book with the "local" option tombstones the row but keeps
        # uploaded_at; resurrecting it row-only would leave an undownloadable book.
        wire = wire_for()
        row = synced_row(wire)
        row['deleted_at'] = '2024-06-01T00:00:00.000Z'
        plan = plan_push(row, wire, 'c' * 32, SRC, blob_present=False)
        self.assertEqual(plan['action'], 'replace')

    def test_missing_blob_does_not_affect_new_book(self):
        plan = plan_push(None, wire_for(), 'c' * 32, SRC, blob_present=False)
        self.assertEqual(plan['action'], 'new')


class BlobLookupTest(unittest.TestCase):
    """`blob_present` may be a callable, consulted only when it can change the answer.

    A storage lookup costs a request, so plan_push must not make one for a book
    the cheaper checks have already routed to new/replace.
    """

    def setUp(self):
        self.asked = []

    def probe(self, result):
        def lookup(book_hash):
            self.asked.append(book_hash)
            return result

        return lookup

    def test_not_consulted_for_a_new_book(self):
        plan = plan_push(None, wire_for(), 'c' * 32, SRC, self.probe(True))
        self.assertEqual(plan['action'], 'new')
        self.assertEqual(self.asked, [])

    def test_not_consulted_when_the_row_has_no_upload(self):
        wire = wire_for()
        row = synced_row(wire)
        row['uploaded_at'] = None
        plan = plan_push(row, wire, 'c' * 32, SRC, self.probe(True))
        self.assertEqual(plan['action'], 'replace')
        self.assertEqual(self.asked, [])

    def test_not_consulted_when_the_source_file_changed(self):
        wire = wire_for(dict(BOOK, source_hash='n' * 32))
        row = synced_row(wire_for())
        plan = plan_push(row, wire, 'c' * 32, 'n' * 32, self.probe(True))
        self.assertEqual(plan['action'], 'replace')
        self.assertEqual(self.asked, [])

    def test_consulted_once_the_cheap_checks_pass(self):
        wire = wire_for()
        row = synced_row(wire)
        row['book_hash'] = 'a' * 32
        self.assertEqual(plan_push(row, wire, 'c' * 32, SRC, self.probe(True))['action'], 'skip')
        self.assertEqual(self.asked, ['a' * 32])

    def test_missing_blob_from_the_callable_forces_replace(self):
        wire = wire_for()
        row = synced_row(wire)
        row['book_hash'] = 'a' * 32
        plan = plan_push(row, wire, 'c' * 32, SRC, self.probe(False))
        self.assertEqual(plan['action'], 'replace')
        self.assertEqual(self.asked, ['a' * 32])


class ShouldBulkListTest(unittest.TestCase):
    def test_one_book_against_a_large_library_uses_per_book_lookups(self):
        self.assertFalse(should_bulk_list(16, 1))

    def test_a_large_selection_pays_for_the_listing(self):
        self.assertTrue(should_bulk_list(16, 88))

    def test_break_even_prefers_the_listing(self):
        self.assertTrue(should_bulk_list(16, 16))

    def test_a_single_page_is_always_worth_it(self):
        # We have to fetch page 1 to learn the count, so it is already paid for.
        self.assertTrue(should_bulk_list(1, 1))
        self.assertTrue(should_bulk_list(0, 1))


class CloudBookHashesTest(unittest.TestCase):
    def test_book_file_marks_hash_present(self):
        files = [{'file_key': 'user-1/Readest/Books/%s/%s.epub' % ('a' * 32, 'a' * 32)}]
        self.assertEqual(cloud_book_hashes(files), {'a' * 32})

    def test_cover_alone_does_not_mark_hash_present(self):
        files = [{'file_key': 'user-1/Readest/Books/%s/cover.png' % ('a' * 32)}]
        self.assertEqual(cloud_book_hashes(files), set())

    def test_app_uploaded_title_filename(self):
        # The app stores books as {hash}/{title}.{ext}, not {hash}/{hash}.{ext}.
        files = [{'file_key': 'user-1/Readest/Books/%s/The Test Book.epub' % ('b' * 32)}]
        self.assertEqual(cloud_book_hashes(files), {'b' * 32})

    def test_ignores_unrelated_and_malformed_keys(self):
        files = [
            {'file_key': 'user-1/Readest/Replicas/notes/r1/notes.db'},
            {'file_key': 'user-1/Readest/Books/%s' % ('c' * 32)},  # no file name
            {'file_key': ''},
            {},
        ]
        self.assertEqual(cloud_book_hashes(files), set())

    def test_empty_listing(self):
        self.assertEqual(cloud_book_hashes([]), set())
        self.assertEqual(cloud_book_hashes(None), set())

    def test_agrees_with_the_keys_we_upload(self):
        # The producer (book_file_name/cover_file_name) and this consumer must
        # not drift; the listing returns them under a user-id prefix.
        book_hash = 'a' * 32
        files = [
            {'file_key': 'user-1/' + book_file_name(book_hash, 'EPUB')},
            {'file_key': 'user-1/' + cover_file_name(book_hash)},
        ]
        self.assertEqual(cloud_book_hashes(files), {book_hash})


class PlanPushAfterStorageWipeTest(unittest.TestCase):
    """The reported failure: files deleted, books rows left claiming uploaded_at."""

    def test_wiped_storage_forces_reupload(self):
        wire = wire_for()
        row = synced_row(wire)
        row['book_hash'] = 'a' * 32
        present = cloud_book_hashes([])  # every file deleted under Manage Storage
        plan = plan_push(row, wire, 'c' * 32, SRC, row['book_hash'] in present)
        self.assertEqual(plan['action'], 'replace')

    def test_intact_storage_still_skips(self):
        wire = wire_for()
        row = synced_row(wire)
        row['book_hash'] = 'a' * 32
        present = cloud_book_hashes(
            [{'file_key': 'user-1/' + book_file_name(row['book_hash'], 'EPUB')}]
        )
        plan = plan_push(row, wire, 'c' * 32, SRC, row['book_hash'] in present)
        self.assertEqual(plan['action'], 'skip')


class MarksTest(unittest.TestCase):
    def test_every_plan_action_has_a_mark(self):
        # plan_push's four actions must all map to a label, or a status check
        # would silently leave books unmarked.
        self.assertEqual(set(PLAN_MARKS), {'new', 'replace', 'update', 'skip'})
        for label in PLAN_MARKS.values():
            self.assertTrue(label.startswith(MARK_PREFIX))

    def test_replaces_our_own_stale_marks(self):
        existing = {1: 'readest_synced', 2: 'readest_missing'}
        self.assertEqual(merge_marks(existing, {1: 'readest_missing'}), {1: 'readest_missing'})

    def test_keeps_marks_the_user_set(self):
        existing = {1: 'true', 2: 'readest_synced', 3: 'todo'}
        merged = merge_marks(existing, {2: 'readest_missing'})
        self.assertEqual(merged, {1: 'true', 3: 'todo', 2: 'readest_missing'})

    def test_new_marks_win_over_a_user_mark_on_the_same_book(self):
        self.assertEqual(merge_marks({1: 'true'}, {1: 'readest_synced'}), {1: 'readest_synced'})

    def test_empty_inputs(self):
        self.assertEqual(merge_marks(None, None), {})
        self.assertEqual(merge_marks({1: 'readest_synced'}, {}), {})
        self.assertEqual(merge_marks({1: 'true'}, {}), {1: 'true'})

    def test_tolerates_non_string_labels(self):
        # calibre stores whatever the marking code passed; 'true' marks can be
        # bare booleans in older libraries.
        merged = merge_marks({1: True}, {2: 'readest_synced'})
        self.assertEqual(merged, {1: True, 2: 'readest_synced'})


class MsToIsoTest(unittest.TestCase):
    def test_round_trips_through_iso_to_ms(self):
        self.assertEqual(iso_to_ms(ms_to_iso(NOW)), NOW)

    def test_none(self):
        self.assertIsNone(ms_to_iso(None))


class ServerRowLookupTest(unittest.TestCase):
    def test_index_rows_by_uuid(self):
        wire = wire_for()
        row = synced_row(wire)
        index = index_rows_by_uuid([row, server_row(book_hash='x' * 32, metadata='not json')])
        self.assertEqual(index, {'cafebabe-0000-0000-0000-000000000001': row})

    def test_index_prefers_live_row(self):
        wire = wire_for()
        dead = synced_row(wire)
        dead['deleted_at'] = '2024-06-01T00:00:00.000Z'
        live = synced_row(wire)
        live['book_hash'] = 'x' * 32
        for rows in ([dead, live], [live, dead]):
            index = index_rows_by_uuid(rows)
            self.assertEqual(index['cafebabe-0000-0000-0000-000000000001'], live)

    def test_index_prefers_newer_row(self):
        wire = wire_for()
        old = synced_row(wire)
        old['updated_at'] = '2024-01-01T00:00:00.000Z'
        new = synced_row(wire)
        new['book_hash'] = 'x' * 32
        new['updated_at'] = '2024-06-01T00:00:00.000Z'
        index = index_rows_by_uuid([old, new])
        self.assertEqual(index['cafebabe-0000-0000-0000-000000000001'], new)

    def test_pick_prefers_live_hash_match(self):
        hash_row = server_row()
        uuid_row = server_row(book_hash='x' * 32)
        self.assertIs(pick_server_row(hash_row, uuid_row), hash_row)

    def test_pick_falls_back_to_live_uuid_row(self):
        dead = server_row(deleted_at='2024-06-01T00:00:00.000Z')
        live = server_row(book_hash='x' * 32)
        self.assertIs(pick_server_row(dead, live), live)

    def test_pick_returns_tombstone_when_nothing_live(self):
        dead = server_row(deleted_at='2024-06-01T00:00:00.000Z')
        self.assertIs(pick_server_row(None, dead), dead)
        self.assertIsNone(pick_server_row(None, None))


class TombstoneRecordTest(unittest.TestCase):
    def test_shape(self):
        rec = tombstone_record(server_row(), NOW)
        self.assertEqual(rec['hash'], 'a' * 32)
        self.assertEqual(rec['bookHash'], 'a' * 32)
        self.assertEqual(rec['format'], 'EPUB')
        self.assertEqual(rec['title'], 'The Test Book')
        self.assertEqual(rec['author'], 'Alice Author, Bob Writer')
        self.assertEqual(rec['createdAt'], iso_to_ms('2024-01-01T00:00:00.000Z'))
        self.assertEqual(rec['updatedAt'], NOW)
        self.assertEqual(rec['deletedAt'], NOW)


class MergeForPushTest(unittest.TestCase):
    def test_new_book_merge(self):
        wire = wire_for()
        rec = merge_for_push(wire, None, NOW, uploaded_at_ms=NOW, cover_hash='e' * 32)
        self.assertEqual(rec['createdAt'], NOW)
        self.assertEqual(rec['updatedAt'], NOW)
        self.assertEqual(rec['uploadedAt'], NOW)
        self.assertEqual(rec['coverHash'], 'e' * 32)
        self.assertEqual(rec['coverUpdatedAt'], NOW)
        self.assertIsNone(rec['deletedAt'])

    def test_update_carries_server_fields(self):
        wire = wire_for(dict(BOOK, title='Renamed'))
        row = server_row(metadata=json.dumps(build_metadata(BOOK)))
        rec = merge_for_push(wire, row, NOW)
        # Fields the server would explicit-null if omitted must be carried over.
        self.assertEqual(rec['groupId'], 'g1')
        self.assertEqual(rec['groupName'], 'Group One')
        self.assertEqual(rec['progress'], [3, 100])
        self.assertEqual(rec['readingStatus'], 'reading')
        self.assertEqual(rec['readingStatusUpdatedAt'], iso_to_ms('2024-01-02T00:00:00.000Z'))
        self.assertEqual(rec['uploadedAt'], iso_to_ms('2024-01-01T12:00:00.000Z'))
        self.assertEqual(rec['coverHash'], 'c' * 32)
        self.assertEqual(rec['coverUpdatedAt'], iso_to_ms('2024-01-02T00:00:00.000Z'))
        self.assertEqual(rec['createdAt'], iso_to_ms('2024-01-01T00:00:00.000Z'))
        # LWW: the push must win over the server row.
        self.assertEqual(rec['updatedAt'], NOW)
        # Our fresh metadata wins.
        self.assertEqual(rec['title'], 'Renamed')
        # Resurrects tombstones.
        self.assertIsNone(rec['deletedAt'])

    def test_reupload_overrides_uploaded_at(self):
        wire = wire_for()
        row = server_row(uploaded_at=None)
        rec = merge_for_push(wire, row, NOW, uploaded_at_ms=NOW)
        self.assertEqual(rec['uploadedAt'], NOW)

    def test_new_cover_overrides_server_cover(self):
        wire = wire_for()
        rec = merge_for_push(wire, server_row(), NOW, cover_hash='f' * 32)
        self.assertEqual(rec['coverHash'], 'f' * 32)
        self.assertEqual(rec['coverUpdatedAt'], NOW)

    # The server resolves title/author/tags/metadata by metadata_updated_at
    # (field-level LWW, readest#5438). A push that changes the group must stamp
    # it or a stale stamped edit on the server would win the merge.
    def test_metadata_change_stamps_metadata_updated_at(self):
        wire = wire_for(dict(BOOK, title='Renamed'))
        row = server_row(metadata=json.dumps(build_metadata(BOOK)))
        rec = merge_for_push(wire, row, NOW)
        self.assertEqual(rec['metadataUpdatedAt'], NOW)

    def test_new_book_stamps_metadata_updated_at(self):
        rec = merge_for_push(wire_for(), None, NOW, uploaded_at_ms=NOW)
        self.assertEqual(rec['metadataUpdatedAt'], NOW)

    def test_unchanged_metadata_carries_server_stamp(self):
        # Cover-only update: the group is untouched, so the row's stamp is
        # carried over — advancing it would let this push beat a genuinely
        # newer Readest edit racing with it.
        wire = wire_for()
        row = synced_row(wire)
        row['metadata_updated_at'] = '2024-01-03T00:00:00.000Z'
        rec = merge_for_push(wire, row, NOW, cover_hash='f' * 32)
        self.assertEqual(rec['metadataUpdatedAt'], iso_to_ms('2024-01-03T00:00:00.000Z'))


if __name__ == '__main__':
    unittest.main()
