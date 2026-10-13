__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

"""Browser OAuth sign-in via a localhost callback server.

Supabase redirects OAuth logins to the whitelisted http://localhost:{port}
with the session tokens in the URL *fragment* — the same flow readest-app's
desktop custom-OAuth mode uses (tauri-plugin-oauth). Fragments never reach an
HTTP server, so the first response serves a page whose script forwards the
fragment as query parameters to /callback. Standard-library only.
"""

import threading
import urllib.parse
from html import escape
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    load_translations()
except NameError:
    # Running outside calibre's plugin loader (unit tests): no translations.
    def _(text):
        return text

PROVIDERS = ('google', 'apple', 'github', 'discord')


def _page(title, text, script=''):
    return (
        '<!DOCTYPE html>\n<html><head><title>%s</title></head><body>\n<p>%s</p>%s</body></html>'
        % (escape(title), escape(text), script)
    )


def landing_page():
    return _page(
        _('Readest Login'),
        _('Completing login…'),
        '<script>\n'
        "  var hash = window.location.hash.replace(/^#/, '');\n"
        "  window.location.replace('/callback?' + hash);\n"
        '</script>',
    )


def done_page():
    return _page(
        _('Readest Login'),
        _('Login complete. You can close this tab and return to calibre.'),
    )


def build_authorize_url(supabase_url, provider, port):
    return '%s/auth/v1/authorize?%s' % (
        supabase_url.rstrip('/'),
        urllib.parse.urlencode({'provider': provider, 'redirect_to': 'http://localhost:%d' % port}),
    )


def parse_callback_query(query):
    """Extract session tokens (or an OAuth error) from the callback query."""
    params = urllib.parse.parse_qs(query)
    result = {}
    for key in ('access_token', 'refresh_token', 'error', 'error_description'):
        if key in params:
            result[key] = params[key][0]
    for key in ('expires_at', 'expires_in'):
        if key in params:
            try:
                result[key] = int(params[key][0])
            except ValueError:
                pass
    return result


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/callback':
            tokens = parse_callback_query(parsed.query)
            self._respond(done_page())
            if tokens:
                self.server.oauth_result = tokens
                self.server.oauth_event.set()
        else:
            self._respond(landing_page())

    def _respond(self, page):
        if isinstance(page, str):
            page = page.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args):
        pass  # keep calibre's stdout clean


class OAuthCallbackServer:
    def __init__(self):
        self._server = None
        self._thread = None

    def start(self):
        """Bind to an ephemeral port and serve in a daemon thread."""
        self._server = HTTPServer(('127.0.0.1', 0), _Handler)
        self._server.oauth_result = None
        self._server.oauth_event = threading.Event()
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self._server.server_address[1]

    def wait(self, timeout):
        """Tokens dict once the callback arrives, or None on timeout/stop."""
        server = self._server
        if server is None or not server.oauth_event.wait(timeout):
            return None
        return server.oauth_result

    def stop(self):
        server, self._server = self._server, None
        if server:
            server.oauth_event.set()  # wake any wait()er (returns None)
            server.shutdown()
            server.server_close()
