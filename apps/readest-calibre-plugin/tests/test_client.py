import io
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from api import (  # noqa: E402
    AuthRequiredError,
    QuotaExceededError,
    ReadestAPIError,
    ReadestClient,
)

API_BASE = 'https://web.example.com/api'
SUPABASE = 'https://sb.example.com'
ANON_KEY = 'anon-key'


class FakeTransport:
    """Records requests; replies from a queue of (status, json_body) tuples."""

    def __init__(self):
        self.requests = []
        self.responses = []

    def queue(self, status, body):
        self.responses.append((status, body))

    def __call__(self, request, timeout):
        data = request.data
        if hasattr(data, 'read'):
            data = data.read()
        self.requests.append(
            {
                'method': request.get_method(),
                'url': request.full_url,
                'headers': {k.lower(): v for k, v in request.header_items()},
                'body': data,
            }
        )
        status, body = self.responses.pop(0)
        payload = body if isinstance(body, bytes) else json.dumps(body).encode('utf-8')
        return status, payload


def make_client(transport, tokens=None, saved=None):
    def on_tokens(t):
        if saved is not None:
            saved.append(t)

    return ReadestClient(
        api_base=API_BASE,
        supabase_url=SUPABASE,
        anon_key=ANON_KEY,
        tokens=tokens,
        on_tokens=on_tokens,
        transport=transport,
    )


def valid_tokens(expires_in=3600):
    return {
        'access_token': 'at',
        'refresh_token': 'rt',
        'expires_at': int(time.time()) + expires_in,
        'expires_in': expires_in,
    }


class SignInTest(unittest.TestCase):
    def test_password_sign_in_stores_tokens(self):
        transport = FakeTransport()
        saved = []
        transport.queue(
            200,
            {
                'access_token': 'new-at',
                'refresh_token': 'new-rt',
                'expires_at': 1234,
                'expires_in': 3600,
                'user': {'id': 'u1', 'email': 'a@b.c'},
            },
        )
        client = make_client(transport, saved=saved)
        user = client.sign_in_password('a@b.c', 'pw')

        req = transport.requests[0]
        self.assertEqual(req['method'], 'POST')
        self.assertEqual(req['url'], f'{SUPABASE}/auth/v1/token?grant_type=password')
        self.assertEqual(req['headers']['apikey'], ANON_KEY)
        self.assertEqual(json.loads(req['body']), {'email': 'a@b.c', 'password': 'pw'})
        self.assertEqual(user['id'], 'u1')
        self.assertEqual(saved[-1]['access_token'], 'new-at')

    def test_failed_sign_in_raises_with_message(self):
        transport = FakeTransport()
        transport.queue(400, {'error_description': 'Invalid login credentials'})
        client = make_client(transport)
        with self.assertRaises(ReadestAPIError) as ctx:
            client.sign_in_password('a@b.c', 'bad')
        self.assertIn('Invalid login credentials', str(ctx.exception))


class TokenRefreshTest(unittest.TestCase):
    def test_fresh_token_not_refreshed(self):
        transport = FakeTransport()
        transport.queue(200, {'books': []})
        client = make_client(transport, tokens=valid_tokens())
        client.pull_books()
        self.assertEqual(len(transport.requests), 1)  # no refresh round-trip

    def test_expiring_token_refreshed_before_call(self):
        transport = FakeTransport()
        saved = []
        transport.queue(
            200,
            {'access_token': 'at2', 'refresh_token': 'rt2', 'expires_at': 99, 'expires_in': 3600},
        )
        transport.queue(200, {'books': []})
        tokens = valid_tokens()
        tokens['expires_at'] = int(time.time()) + 10  # nearly expired
        client = make_client(transport, tokens=tokens, saved=saved)
        client.pull_books()

        self.assertEqual(
            transport.requests[0]['url'],
            f'{SUPABASE}/auth/v1/token?grant_type=refresh_token',
        )
        self.assertEqual(json.loads(transport.requests[0]['body']), {'refresh_token': 'rt'})
        self.assertEqual(transport.requests[1]['headers']['authorization'], 'Bearer at2')
        self.assertEqual(saved[-1]['access_token'], 'at2')

    def test_no_tokens_raises_auth_required(self):
        client = make_client(FakeTransport())
        with self.assertRaises(AuthRequiredError):
            client.pull_books()


class SyncTest(unittest.TestCase):
    def test_pull_books(self):
        transport = FakeTransport()
        transport.queue(200, {'books': [{'book_hash': 'h1'}]})
        client = make_client(transport, tokens=valid_tokens())
        books = client.pull_books()

        req = transport.requests[0]
        self.assertEqual(req['method'], 'GET')
        self.assertEqual(req['url'], f'{API_BASE}/sync?type=books&since=0')
        self.assertEqual(req['headers']['authorization'], 'Bearer at')
        self.assertEqual(books, [{'book_hash': 'h1'}])

    def test_push_books(self):
        transport = FakeTransport()
        transport.queue(200, {'books': [{'book_hash': 'h1'}]})
        client = make_client(transport, tokens=valid_tokens())
        client.push_books([{'hash': 'h1', 'title': 'T'}])

        req = transport.requests[0]
        self.assertEqual(req['method'], 'POST')
        self.assertEqual(req['url'], f'{API_BASE}/sync')
        body = json.loads(req['body'])
        self.assertEqual(body['books'][0]['hash'], 'h1')
        self.assertEqual(body['notes'], [])
        self.assertEqual(body['configs'], [])


class StorageTest(unittest.TestCase):
    def test_get_upload_url(self):
        transport = FakeTransport()
        transport.queue(200, {'uploadUrl': 'https://s3/put', 'fileKey': 'k'})
        client = make_client(transport, tokens=valid_tokens())
        res = client.get_upload_url('Readest/Books/h/h.epub', 5, 'h')

        body = json.loads(transport.requests[0]['body'])
        self.assertEqual(body['fileName'], 'Readest/Books/h/h.epub')
        self.assertEqual(body['fileSize'], 5)
        self.assertEqual(body['bookHash'], 'h')
        self.assertEqual(res['uploadUrl'], 'https://s3/put')

    def test_quota_exceeded(self):
        transport = FakeTransport()
        transport.queue(403, {'error': 'Insufficient storage quota', 'usage': 1})
        client = make_client(transport, tokens=valid_tokens())
        with self.assertRaises(QuotaExceededError):
            client.get_upload_url('f', 5, 'h')

    def test_put_file_sends_content_length(self):
        transport = FakeTransport()
        transport.queue(200, b'')
        client = make_client(transport, tokens=valid_tokens())
        client.put_file('https://s3/put', io.BytesIO(b'12345'), 5)

        req = transport.requests[0]
        self.assertEqual(req['method'], 'PUT')
        self.assertEqual(req['headers']['content-length'], '5')
        self.assertEqual(req['body'], b'12345')

    def test_put_file_failure_raises(self):
        transport = FakeTransport()
        transport.queue(500, b'<Error><Code>InternalError</Code></Error>')
        client = make_client(transport, tokens=valid_tokens())
        with self.assertRaises(ReadestAPIError):
            client.put_file('https://s3/put', io.BytesIO(b'x'), 1)


if __name__ == '__main__':
    unittest.main()
