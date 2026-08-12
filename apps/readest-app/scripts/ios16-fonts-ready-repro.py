#!/usr/bin/env python3
# Standalone repro for the iOS <= 16 WebKit fonts.ready WebContent crash.
#
# Serves a page whose @font-face request never completes, accesses
# document.fonts.ready (creating the JS deferred promise), then swaps the
# stylesheet's textContent. The next natural render tick rebuilds the style
# resolver, purges the still-loading face (CSSFontFaceSet::purge), drops the
# active count to zero and resolves the ready promise synchronously inside
# style resolution.
#
# Affected engines (iOS 16.x WKWebView/Safari): the WebContent process dies;
# Safari shows "A problem repeatedly occurred" or reloads a blank page.
# Unaffected engines: the status line keeps counting "STILL ALIVE".
#
# Usage:  python3 ios16-fonts-ready-repro.py [port]   # default 0.0.0.0:8817
#         open http://<this-mac-lan-ip>:<port>/ in Safari on the test device
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = b"""<!doctype html>
<meta name=viewport content="width=device-width, initial-scale=1">
<title>fonts.ready purge repro</title>
<body>
<p id=t style="font-size:24px">Text that will force the NeverLoads font to start fetching.</p>
<p id=status>booting...</p>
<script>
const status = document.getElementById('status')
const log = m => { status.textContent = m; console.log(m) }

// Sequencing matters (WebCore FontFaceSet, safari-7615-branch):
// - The ready promise starts pending only if the FontFaceSet wrapper is
//   created before loadEventFinished, or while processingLoadEvent.
// - documentDidFinishLoading() runs right after the load event dispatch
//   and resolves the promise UNLESS a font face is actively loading.
// - completedLoading() resolves only once m_isDocumentLoaded is true.
// So: inside the load handler, create the promise AND start a font fetch
// that never completes; after the handler returns the promise stays
// pending until the purge resolves it inside style resolution.
addEventListener('load', () => {
  // Step 1: create the JS deferred promise while processingLoadEvent.
  document.fonts.ready.then(() => log('fonts.ready RESOLVED (engine survived)'))

  // Step 2: inject the @font-face and force a synchronous layout so the
  // (never-completing) font request starts before the handler returns.
  const style = document.createElement('style')
  style.id = 's'
  style.textContent =
    "@font-face { font-family: NeverLoads; src: url('/slow-font.woff2'); }" +
    '#t { font-family: NeverLoads, serif; }'
  document.head.appendChild(style)
  void document.body.offsetWidth
  log('font status after forced layout: ' + document.fonts.status)

  // Step 3: with the font still in flight, swap the stylesheet like
  // foliate's setStyles does. Do NOT force layout from JS; the natural
  // rendering update rebuilds the style resolver with script disallowed,
  // purges the loading face and resolves the ready promise there.
  setTimeout(() => {
    document.getElementById('s').textContent = '#t { color: red; }'
    log('stylesheet swapped, waiting for render tick...')
    let n = 0
    setInterval(() => log('STILL ALIVE ' + (++n) + 's after swap (engine not affected)'), 1000)
  }, 1000)
})
</script>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/slow-font.woff2':
            # Headers sent, body never delivered: the face stays Loading.
            self.send_response(200)
            self.send_header('Content-Type', 'font/woff2')
            self.send_header('Content-Length', '100000')
            self.end_headers()
            time.sleep(600)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, fmt, *args):
        print('[%s] %s' % (self.address_string(), fmt % args), flush=True)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('192.0.2.1', 80))
        return s.getsockname()[0]
    finally:
        s.close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8817
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print('Serving repro at http://%s:%d/' % (lan_ip(), port), flush=True)
    print('Open it in Safari on the test device.', flush=True)
    print('Crash = blank page / "A problem repeatedly occurred".', flush=True)
    print('No crash = "STILL ALIVE Ns after swap" keeps counting.', flush=True)
    server.serve_forever()
