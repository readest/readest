import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from wire import (  # noqa: E402
    build_metadata,
    build_wire_book,
    iso_to_ms,
    merge_for_push,
    pick_format,
    plan_push,
)

NOW = 1_800_000_000_000

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

    def test_single_author_is_string(self):
        meta = build_metadata(dict(BOOK, authors=['Solo']))
        self.assertEqual(meta['author'], 'Solo')

    def test_omits_empty_fields(self):
        meta = build_metadata({'title': 'T', 'authors': []})
        self.assertNotIn('publisher', meta)
        self.assertNotIn('series', meta)
        self.assertNotIn('customColumns', meta)
        self.assertNotIn('isbn', meta)

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
        plan = plan_push(None, wire_for(), local_cover_hash='c' * 32)
        self.assertEqual(plan['action'], 'new')
        self.assertTrue(plan['upload_cover'])

    def test_new_book_without_cover(self):
        plan = plan_push(None, wire_for(), local_cover_hash=None)
        self.assertEqual(plan['action'], 'new')
        self.assertFalse(plan['upload_cover'])

    def test_row_without_file_needs_reupload(self):
        wire = wire_for()
        row = synced_row(wire)
        row['uploaded_at'] = None
        plan = plan_push(row, wire, local_cover_hash='c' * 32)
        self.assertEqual(plan['action'], 'reupload')
        self.assertFalse(plan['upload_cover'])  # cover_hash matches

    def test_unchanged_book_is_skipped(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, local_cover_hash='c' * 32)
        self.assertEqual(plan['action'], 'skip')

    def test_changed_metadata_is_update(self):
        wire = wire_for(dict(BOOK, title='Renamed Title'))
        row = synced_row(wire_for())
        plan = plan_push(row, wire, local_cover_hash='c' * 32)
        self.assertEqual(plan['action'], 'update')
        self.assertFalse(plan['upload_cover'])

    def test_changed_cover_only_is_update_with_cover(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, local_cover_hash='d' * 32)
        self.assertEqual(plan['action'], 'update')
        self.assertTrue(plan['upload_cover'])

    def test_tombstoned_row_is_resurrected(self):
        wire = wire_for()
        row = synced_row(wire)
        row['deleted_at'] = '2024-06-01T00:00:00.000Z'
        plan = plan_push(row, wire, local_cover_hash='c' * 32)
        self.assertEqual(plan['action'], 'update')

    def test_tags_change_is_update(self):
        wire = wire_for(dict(BOOK, tags=['Fiction']))
        row = synced_row(wire_for())
        self.assertEqual(plan_push(row, wire, 'c' * 32)['action'], 'update')

    def test_missing_local_cover_does_not_force_update(self):
        wire = wire_for()
        plan = plan_push(synced_row(wire), wire, local_cover_hash=None)
        self.assertEqual(plan['action'], 'skip')


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


if __name__ == '__main__':
    unittest.main()
