import os
import sys
import unittest
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from oauth import OAuthCallbackServer, build_authorize_url, parse_callback_query  # noqa: E402


class AuthorizeUrlTest(unittest.TestCase):
    def test_url_shape(self):
        url = build_authorize_url('https://sb.example.com', 'google', 43210)
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(parsed.scheme, 'https')
        self.assertEqual(parsed.netloc, 'sb.example.com')
        self.assertEqual(parsed.path, '/auth/v1/authorize')
        self.assertEqual(query['provider'], ['google'])
        self.assertEqual(query['redirect_to'], ['http://localhost:43210'])


class ParseCallbackQueryTest(unittest.TestCase):
    def test_tokens(self):
        tokens = parse_callback_query(
            'access_token=at&refresh_token=rt&expires_at=123&expires_in=3600&token_type=bearer'
        )
        self.assertEqual(tokens['access_token'], 'at')
        self.assertEqual(tokens['refresh_token'], 'rt')
        self.assertEqual(tokens['expires_at'], 123)
        self.assertEqual(tokens['expires_in'], 3600)

    def test_error(self):
        tokens = parse_callback_query('error=access_denied&error_description=Denied')
        self.assertEqual(tokens['error'], 'access_denied')
        self.assertEqual(tokens['error_description'], 'Denied')

    def test_missing_tokens(self):
        self.assertEqual(parse_callback_query(''), {})


class CallbackServerTest(unittest.TestCase):
    def test_full_roundtrip(self):
        server = OAuthCallbackServer()
        port = server.start()
        try:
            # First request: Supabase redirects to "/" with tokens in the URL
            # fragment, which never reaches the server — it must serve a page
            # whose script forwards the fragment as query params.
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=5) as res:
                page = res.read().decode('utf-8')
            self.assertIn('location.hash', page)
            self.assertIn('/callback', page)

            with urllib.request.urlopen(
                f'http://127.0.0.1:{port}/callback?access_token=at&refresh_token=rt'
                '&expires_at=123&expires_in=3600',
                timeout=5,
            ) as res:
                self.assertEqual(res.status, 200)

            tokens = server.wait(timeout=5)
            self.assertIsNotNone(tokens)
            self.assertEqual(tokens['access_token'], 'at')
            self.assertEqual(tokens['refresh_token'], 'rt')
        finally:
            server.stop()

    def test_wait_timeout(self):
        server = OAuthCallbackServer()
        server.start()
        try:
            self.assertIsNone(server.wait(timeout=0.1))
        finally:
            server.stop()

    def test_stop_wakes_waiter(self):
        import threading
        import time

        server = OAuthCallbackServer()
        server.start()
        threading.Timer(0.1, server.stop).start()
        started = time.monotonic()
        self.assertIsNone(server.wait(timeout=10))
        self.assertLess(time.monotonic() - started, 5)


if __name__ == '__main__':
    unittest.main()
