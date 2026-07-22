import hashlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from api import meta_hash, partial_md5, partial_md5_bytes  # noqa: E402


def reference_ranges(size):
    """Chunk ranges of utils/md5.ts::partialMD5, computed independently.

    The JS loop runs i in -1..10 with start = min(size, 1024 << (2*i)); the
    JS << operator wraps 1024 << -2 to 0, so i == -1 reads offset 0.
    """
    ranges = []
    for i in range(-1, 11):
        offset = 0 if i == -1 else 1024 << (2 * i)
        start = min(size, offset)
        if start >= size:
            break
        ranges.append((start, min(start + 1024, size)))
    return ranges


def reference_hash(data):
    hasher = hashlib.md5()
    for start, end in reference_ranges(len(data)):
        hasher.update(data[start:end])
    return hasher.hexdigest()


class PartialMd5Test(unittest.TestCase):
    def check(self, data):
        self.assertEqual(partial_md5(io.BytesIO(data), len(data)), reference_hash(data))
        self.assertEqual(partial_md5_bytes(data), reference_hash(data))

    def test_small_file_reads_everything(self):
        data = b'hello world'
        self.assertEqual(partial_md5_bytes(data), hashlib.md5(data).hexdigest())

    def test_exactly_one_chunk(self):
        self.check(bytes(range(256)) * 4)  # 1024 bytes

    def test_two_chunks(self):
        self.check(os.urandom(3000))

    def test_skips_middle_of_larger_file(self):
        data = os.urandom(20000)
        self.check(data)
        # Sanity: 20000 bytes covers offsets 0, 1024, 4096, 16384 then stops.
        self.assertEqual(
            reference_ranges(20000),
            [(0, 1024), (1024, 2048), (4096, 5120), (16384, 17408)],
        )

    def test_from_file_path(self, tmp_name='partial_md5_fixture.bin'):
        import tempfile

        data = os.urandom(5000)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, tmp_name)
            with open(path, 'wb') as f:
                f.write(data)
            self.assertEqual(partial_md5(path), reference_hash(data))


class MetaHashTest(unittest.TestCase):
    def md5(self, source):
        import unicodedata

        return hashlib.md5(unicodedata.normalize('NFC', source).encode('utf-8')).hexdigest()

    def test_basic(self):
        self.assertEqual(
            meta_hash('Foo', ['Alice', 'Bob'], ['urn:uuid:1234']),
            self.md5('Foo|Alice,Bob|1234'),
        )

    def test_prefers_uuid_over_isbn(self):
        self.assertEqual(
            meta_hash('Foo', ['Alice'], ['isbn:9781234567890', 'uuid:abcd']),
            self.md5('Foo|Alice|abcd'),
        )

    def test_calibre_scheme_preferred_over_isbn(self):
        self.assertEqual(
            meta_hash('Foo', ['Alice'], ['isbn:9781234567890', 'calibre:42']),
            self.md5('Foo|Alice|42'),
        )

    def test_urn_identifier_sliced_after_last_colon(self):
        self.assertEqual(
            meta_hash('T', ['A'], ['urn:isbn:978-0-00-000000-0']),
            self.md5('T|A|978-0-00-000000-0'),
        )

    def test_no_identifiers(self):
        self.assertEqual(meta_hash('T', ['A'], []), self.md5('T|A|'))

    def test_plain_identifier_without_scheme(self):
        self.assertEqual(meta_hash('T', ['A'], ['abcdef']), self.md5('T|A|abcdef'))

    def test_nfc_normalization(self):
        decomposed = 'Cafe\u0301'  # e + combining acute accent
        composed = 'Caf\u00e9'
        self.assertEqual(
            meta_hash(decomposed, [], []),
            hashlib.md5(f'{composed}||'.encode('utf-8')).hexdigest(),
        )


if __name__ == '__main__':
    unittest.main()
