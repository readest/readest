__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

"""HTTP client + content hashes for the Readest cloud API.

Standard-library only (no calibre / Qt imports) so it can be unit-tested
outside calibre. The endpoints and shapes mirror the ones already consumed by
readest.koplugin (readest-sync-api.json / supabase-auth-api.json) and served
by apps/readest-app/src/pages/api/.
"""

import hashlib
import json
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_API_BASE = 'https://web.readest.com/api'
DEFAULT_SUPABASE_URL = 'https://readest.supabase.co'
# Public anon key, same one readest.koplugin ships (base64-encoded in main.lua).
DEFAULT_ANON_KEY = (
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic3l4ZnVzampxZHhranFseXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3'
    'MzQxMjM2NzEsImV4cCI6MjA0OTY5OTY3MX0.'
    '3U5Uqaou_1SgrVe1eo9rApc0uKjqhpQdUXhvwUHmUfg'
)

TIMEOUT = 30
UPLOAD_TIMEOUT = 600


class ReadestAPIError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class AuthRequiredError(ReadestAPIError):
    """No valid session — the user must log in."""


class QuotaExceededError(ReadestAPIError):
    """The server rejected an upload for insufficient storage quota."""


# ---------------------------------------------------------------------------
# Content hashes
# ---------------------------------------------------------------------------


def _partial_md5_ranges(size):
    """Chunk ranges of apps/readest-app/src/utils/md5.ts::partialMD5.

    1024-byte chunks at offsets 0, 1024, 4096, ..., 1024 << 20 (the JS loop
    runs i in -1..10; `1024 << -2` wraps to 0 under JS 32-bit shift).
    """
    ranges = []
    for i in range(-1, 11):
        offset = 0 if i == -1 else 1024 << (2 * i)
        start = min(size, offset)
        if start >= size:
            break
        ranges.append((start, min(start + 1024, size)))
    return ranges


def partial_md5(file_or_path, size=None):
    """Readest's Book.hash: partial MD5 of a file (KOReader-compatible)."""
    if isinstance(file_or_path, str):
        with open(file_or_path, 'rb') as f:
            f.seek(0, 2)
            return partial_md5(f, f.tell())
    f = file_or_path
    hasher = hashlib.md5()
    for start, end in _partial_md5_ranges(size):
        f.seek(start)
        hasher.update(f.read(end - start))
    return hasher.hexdigest()


def partial_md5_bytes(data):
    hasher = hashlib.md5()
    for start, end in _partial_md5_ranges(len(data)):
        hasher.update(data[start:end])
    return hasher.hexdigest()


def _normalize_identifier(identifier):
    # Mirrors utils/book.ts::normalizeIdentifier.
    if 'urn:' in identifier:
        return identifier.rsplit(':', 1)[-1]
    if ':' in identifier:
        return identifier.split(':', 1)[1]
    return identifier


def _identifiers_list(identifiers):
    # Mirrors utils/book.ts::getIdentifiersList / getPreferredIdentifier.
    if not identifiers:
        return []
    for scheme in ('uuid', 'calibre', 'isbn'):
        for identifier in identifiers:
            if scheme in identifier.lower():
                return [_normalize_identifier(identifier)]
    return [_normalize_identifier(i) for i in identifiers if i]


def meta_hash(title, authors, identifiers):
    """Readest's Book.metaHash: md5 over "title|authors|identifiers" (NFC).

    `identifiers` are raw identifier strings, scheme-prefixed where known
    (e.g. "urn:uuid:...", "isbn:...").
    """
    source = '%s|%s|%s' % (
        title or '',
        ','.join(authors or []),
        ','.join(_identifiers_list(identifiers)),
    )
    return hashlib.md5(unicodedata.normalize('NFC', source).encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------


def _default_transport(request, timeout):
    try:
        with urllib.request.urlopen(request, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


class ReadestClient:
    """Supabase auth + Readest sync/storage API client.

    tokens: dict with access_token / refresh_token / expires_at (epoch s) /
    expires_in (s), persisted through the on_tokens callback whenever they
    change. `transport(request, timeout) -> (status, body_bytes)` is
    injectable for tests.
    """

    def __init__(
        self,
        api_base=DEFAULT_API_BASE,
        supabase_url=DEFAULT_SUPABASE_URL,
        anon_key=DEFAULT_ANON_KEY,
        tokens=None,
        on_tokens=None,
        transport=None,
    ):
        self.api_base = api_base.rstrip('/')
        self.supabase_url = supabase_url.rstrip('/')
        self.anon_key = anon_key
        self.tokens = dict(tokens) if tokens else None
        self.on_tokens = on_tokens
        self.transport = transport or _default_transport

    # -- plumbing -----------------------------------------------------------

    def _request(self, method, url, headers, body=None, timeout=TIMEOUT):
        data = None
        if body is not None:
            data = json.dumps(body).encode('utf-8')
            headers = dict(headers, **{'Content-Type': 'application/json'})
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        status, payload = self.transport(request, timeout)
        parsed = None
        if payload:
            try:
                parsed = json.loads(payload.decode('utf-8'))
            except (ValueError, UnicodeDecodeError):
                parsed = None
        return status, parsed, payload

    @staticmethod
    def _error_message(parsed, payload, fallback):
        if isinstance(parsed, dict):
            for key in ('error_description', 'msg', 'message', 'error'):
                value = parsed.get(key)
                if isinstance(value, str) and value:
                    return value
        if payload:
            return payload.decode('utf-8', 'replace')[:200]
        return fallback

    # -- Supabase auth ------------------------------------------------------

    def _auth_headers(self):
        return {'apikey': self.anon_key, 'Accept': 'application/json'}

    def _store_tokens(self, body):
        self.tokens = {
            'access_token': body.get('access_token'),
            'refresh_token': body.get('refresh_token'),
            'expires_at': body.get('expires_at'),
            'expires_in': body.get('expires_in'),
        }
        if self.on_tokens:
            self.on_tokens(dict(self.tokens))

    def sign_in_password(self, email, password):
        status, parsed, payload = self._request(
            'POST',
            self.supabase_url + '/auth/v1/token?grant_type=password',
            self._auth_headers(),
            body={'email': email, 'password': password},
        )
        if status != 200 or not isinstance(parsed, dict):
            raise ReadestAPIError(self._error_message(parsed, payload, 'Login failed'), status)
        self._store_tokens(parsed)
        return parsed.get('user') or {}

    def set_session(self, tokens):
        """Adopt tokens obtained externally (browser OAuth callback)."""
        self._store_tokens(tokens)

    def refresh(self):
        refresh_token = self.tokens and self.tokens.get('refresh_token')
        if not refresh_token:
            raise AuthRequiredError('Not logged in')
        status, parsed, payload = self._request(
            'POST',
            self.supabase_url + '/auth/v1/token?grant_type=refresh_token',
            self._auth_headers(),
            body={'refresh_token': refresh_token},
        )
        if status != 200 or not isinstance(parsed, dict):
            raise AuthRequiredError(
                self._error_message(parsed, payload, 'Session expired, please log in again'),
                status,
            )
        self._store_tokens(parsed)

    def ensure_fresh_token(self):
        # Mirrors readest_syncauth.lua: refresh once less than half the TTL
        # remains; a token past its final minute is unusable without refresh.
        if not self.tokens or not self.tokens.get('access_token'):
            raise AuthRequiredError('Not logged in')
        expires_at = self.tokens.get('expires_at') or 0
        expires_in = self.tokens.get('expires_in') or 3600
        if expires_at < time.time() + max(60, expires_in / 2):
            self.refresh()

    def get_user(self):
        self.ensure_fresh_token()
        headers = dict(self._auth_headers())
        headers['Authorization'] = 'Bearer ' + self.tokens['access_token']
        status, parsed, payload = self._request(
            'GET', self.supabase_url + '/auth/v1/user', headers
        )
        if status != 200 or not isinstance(parsed, dict):
            raise AuthRequiredError(self._error_message(parsed, payload, 'Not logged in'), status)
        return parsed

    def sign_out(self):
        if not self.tokens or not self.tokens.get('access_token'):
            return
        headers = dict(self._auth_headers())
        headers['Authorization'] = 'Bearer ' + self.tokens['access_token']
        try:
            self._request('POST', self.supabase_url + '/auth/v1/logout', headers, body={})
        except Exception:
            pass  # best-effort; local tokens are cleared regardless
        self.tokens = None
        if self.on_tokens:
            self.on_tokens(None)

    # -- Readest API --------------------------------------------------------

    def _api(self, method, path, body=None):
        self.ensure_fresh_token()
        headers = {
            'Authorization': 'Bearer ' + self.tokens['access_token'],
            'Accept': 'application/json',
        }
        status, parsed, payload = self._request(method, self.api_base + path, headers, body=body)
        if status in (401, 403):
            message = self._error_message(parsed, payload, 'Not authenticated')
            if 'quota' in message.lower():
                raise QuotaExceededError(message, status)
            raise AuthRequiredError(message, status)
        if status != 200:
            raise ReadestAPIError(
                self._error_message(parsed, payload, 'Request failed (%s)' % status), status
            )
        return parsed

    def pull_books(self, since=0):
        result = self._api('GET', '/sync?type=books&since=%d' % since)
        return (result or {}).get('books') or []

    def push_books(self, records):
        return self._api('POST', '/sync', body={'books': records, 'notes': [], 'configs': []})

    def get_upload_url(self, file_name, file_size, book_hash):
        return self._api(
            'POST',
            '/storage/upload',
            body={'fileName': file_name, 'fileSize': file_size, 'bookHash': book_hash},
        )

    def list_files(self, book_hash):
        result = self._api('GET', '/storage/list?bookHash=' + urllib.parse.quote(book_hash))
        return (result or {}).get('files') or []

    def delete_file(self, file_key):
        return self._api(
            'DELETE', '/storage/delete?fileKey=' + urllib.parse.quote(file_key, safe='')
        )

    def put_file(self, url, fileobj, size):
        """PUT raw bytes to a presigned URL (no auth headers)."""
        request = urllib.request.Request(
            url,
            data=fileobj,
            headers={'Content-Length': str(size)},
            method='PUT',
        )
        status, payload = self.transport(request, UPLOAD_TIMEOUT)
        if status not in (200, 201, 204):
            message = 'Upload failed (%s)' % status
            if payload:
                # S3/R2 error responses are XML; surface the <Code> tag.
                text = payload.decode('utf-8', 'replace')
                start, end = text.find('<Code>'), text.find('</Code>')
                if 0 <= start < end:
                    message += ': ' + text[start + 6 : end]
            raise ReadestAPIError(message, status)
