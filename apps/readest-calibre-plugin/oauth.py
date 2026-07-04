__license__ = 'AGPL v3'
__copyright__ = '2026, The Readest Authors'

"""Browser OAuth sign-in via a localhost callback server.

Supabase redirects OAuth logins to the whitelisted http://localhost:{port}
with the session tokens in the URL *fragment* — the same flow readest-app's
desktop custom-OAuth mode uses (tauri-plugin-oauth). Fragments never reach an
HTTP server, so the first response serves a page whose script forwards the
fragment as query parameters to /callback. Standard-library only.
"""

import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PROVIDERS = ('google', 'apple', 'github', 'discord')

LANDING_PAGE = b"""<!DOCTYPE html>
<html><head><title>Readest Login</title></head><body>
<p>Completing login&hellip;</p>
<script>
  var hash = window.location.hash.replace(/^#/, '');
  window.location.replace('/callback?' + hash);
</script>
</body></html>"""

DONE_PAGE = b"""<!DOCTYPE html>
<html><head><title>Readest Login</title></head><body>
<p>Login complete. You can close this tab and return to calibre.</p>
</body></html>"""


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
            self._respond(DONE_PAGE)
            if tokens:
                self.server.oauth_result = tokens
                self.server.oauth_event.set()
        else:
            self._respond(LANDING_PAGE)

    def _respond(self, page):
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
