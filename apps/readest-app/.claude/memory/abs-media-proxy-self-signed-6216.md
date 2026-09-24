---
name: abs-media-proxy-self-signed-6216
description: "#6216 ABS playback 'Playback interrupted' on self-signed HTTPS: API client accepts invalid certs (tauri-plugin-http danger:), the WebView <audio> does not; fix = Rust loopback media proxy (hyper) on 127.0.0.1 with per-launch secret; Xiaomi-VERIFIED; MERGED #6268 (730f68a6c, 2026-09-18)"
metadata:
  type: project
---

**Symptom (reporter, Android + Windows, ABS 2.36.0 behind Traefik HTTPS):** library
syncs, every audiobook opens to "Playback interrupted, tap play to retry"; server log =
`GET /api/me`, `POST /api/items/<id>/play` 200, `POST /api/session/<id>/sync` 200, and
NO `/file/` GET. Reporter's own theory (empty `media.tracks` in 2.36.0) is WRONG: the
dev server (192.168.2.3:13378, 2.36.0) returns `contentUrl`/`startOffset`/`duration` on
`media.tracks` (AudioFile+track merged shape) and the same on `/play`'s `audioTracks`.

**Root cause (Xiaomi-reproduced 2026-09-18):** `ABSClient` fetches via tauri-plugin-http
with `danger: { acceptInvalidCerts, acceptInvalidHostnames }` (client.ts), so a
self-signed server connects and syncs. `HtmlAudioClock` is a plain `new Audio()`; the
WebView enforces platform TLS trust and aborts the track request in the handshake
(CDP: `Network.loadingFailed ... net::ERR_ABORTED type=Media`; the proxy saw an
OpenSSL "alert certificate unknown (46)" from the client). `#onError` in
AudiobookController then toasts + fires `onPause` -> that is the mysterious
`/session/<id>/sync` right after `/play`. Access logs never log a failed handshake.

**Fix MERGED #6268 (squash 730f68a6c)** (commits 724afc2c3 + 3011fe2b9 on `fix/abs-media-proxy-6216`, worktree
`/Users/chrox/dev/readest-fix-abs-media-proxy-6216`, from origin/main 030f9c025):
- `src-tauri/src/media_proxy.rs`: hyper http1 server bound to `127.0.0.1:0`, started
  lazily by command `get_media_proxy_base` (tokio OnceCell), base =
  `http://127.0.0.1:<port>/<uuid-v4 secret>`. `GET /<secret>/media?u=<encoded upstream>`
  forwards `Range`, fetches with reqwest `danger_accept_invalid_certs/hostnames`,
  copies content-type/length/range, accept-ranges, etag, last-modified, streams the
  body (`StreamBody` -> `BoxBody`). 404 wrong secret, 400 non-http(s)/userinfo target,
  405 non-GET, 502 unreachable; `log::warn!` on upstream failures (host+path only,
  never the token query). 9 tests incl. an in-test hyper upstream with Range + 401.
- Why not a custom URI scheme: Android WebView re-applies `Range` offsets to
  intercepted bodies (range_file.rs header) and scheme responses are buffered whole.
- Deps: `hyper {http1,server}`, `hyper-util {tokio}`, `http-body-util` (all already in
  the tree via reqwest; root Cargo.lock gains 3 lines under Readest; the fod-hashes
  PR check PASSED with the old cargoHash - direct deps on already-vendored
  crates leave the vendored sources unchanged, so NO hash bump); tokio features + net/sync/time.
- Command = 3 files (lib.rs generate_handler, build.rs AppManifest, capabilities
  default.json + webdriver-remote.json `allow-get-media-proxy-base`); the ACL guard
  test catches omissions.
- TS: `src/services/audiobook/mediaProxy.ts` (`getMediaProxyBase()` memoized invoke;
  null on web AND iOS - AVPlayer clocks take direct URLs; retries after a failure;
  `proxiedMediaUrl`). `openAudiobook.ts` resolveUrl wraps the tokened upstream URL per
  call; `absPairing.ts` `absNarrationTracks/absPreviewClip` take an optional base;
  TTSController resolveTracks + AudiobookPairingDialog preview pass it.
  docs/read-along-narration.md updated.

**Xiaomi verification (dev-android build over 0.12.8, ABS reached via a self-signed
node HTTPS reverse proxy on the Mac loopback + `adb reverse tcp:8443 tcp:8443`, server
URL `https://127.0.0.1:8443`):** before = interrupted toast + TLS alert, no file GET;
after = logcat `media proxy: listening on 127.0.0.1:39325`, WebView GETs
`http://127.0.0.1:39325/<secret>/media?u=...` -> 206, upstream sees
`range=bytes=0-` then `bytes=5242880-7137613`, +30s/-15s seeks, Next/Previous Chapter
across files (28972793 -> 28972822 -> back with a mid-file range) all playing, no toast.
Also proved the diagnostic win: `media proxy: 127.0.0.1 answered 502 Bad Gateway for
/api/items/.../file/28972793` when the dev ABS was down. Windows/Linux/macOS NOT
device-tested. iOS (AVPlayer) still streams direct = still broken for self-signed.

**Gotchas:** the dev ABS at 192.168.2.3:13378 went ECONNREFUSED for ~2 min mid-session
(then `/session/<old id>/sync` -> 404 forever after its restart; pre-existing). The
classifier blocks a proxy bound to 0.0.0.0; loopback + `adb reverse` passed.
`pnpm test -- <file>` ran the WHOLE suite (166s) - use `pnpm test run <file>`; bare
`npx vitest` lacks the dotenv env and fails in supabase.ts. hyper: `StreamBody` is
both `Body` and `Stream`, so `.boxed()` is ambiguous - use `BoxBody::new`. The
reporter's Windows "cert installed but still fails" detail is unexplained (SAN?); the
proxy sidesteps it. Repro script + CDP driver: scratchpad `proxy/proxy.mjs`, `cdp.mjs`.
Left on the Xiaomi: the `https://127.0.0.1:8443` server row + its synced books.


**Hardening added after CodeRabbit + CodeQL review (PR #6268, 2026-09-18):** the
proxy now takes a per-session ORIGIN ALLOWLIST - `get_media_proxy_base(origins:
Vec<String>)` - and refuses (403) any `u=` target whose `scheme://host:port` is
not one of the configured ABS servers, closing the open-relay SSRF (CWE-918) a
leaked secret would otherwise allow. Plus `redirect(Policy::none())` and a 10s
`connect_timeout` on the reqwest client. **Gotcha that cost a device round-trip:**
the JS `absServerOrigins()` FIRST read only `useABSServerStore.getState().servers`,
which the player route opens BEFORE it is hydrated from settings, so the allowlist
was empty and the proxy 403'd the just-opened track (logcat `refused an
off-allowlist origin: https://127.0.0.1:8443`). Fix = mirror `findABSServerById`:
union the store AND `useSettingsStore.getState().settings.absServers`. Re-sent on
every `getMediaProxyBase()` call (no JS memo) so a server added mid-session
registers. Xiaomi RE-VERIFIED: 206 file GETs across chapters, no interrupted toast,
no off-allowlist refusals. CSP note: a page `fetch()` to the loopback proxy is
blocked by connect-src; only the `<audio>` element reaches it (media-src `http://*`)
- so the proxy can't be probed from a devtools `fetch`, only through playback.

**Rebased onto main after #6267 (ABS offline download) 2026-09-18:** semantic conflict in openAudiobook.ts - #6267 added an offline branch (BlobAudioClock/native ExoPlayer, local file paths). Resolution: the proxy wraps ONLY the online streaming resolveUrl branch; `proxyBase = offline ? null : await getMediaProxyBase()` so a downloaded book never touches it. lib.rs/build.rs/capabilities auto-merged (both add a command line). Also added a 10s response-HEADER timeout (`send_with_timeout` -> 504) per a second CodeRabbit Major: connect_timeout bounds only the handshake, a server that stalls after it would park send(); body stream stays unbounded. Force-pushed 3915407e3.
