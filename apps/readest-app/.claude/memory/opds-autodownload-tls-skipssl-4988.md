---
name: opds-autodownload-tls-skipssl-4988
description: "#4988 OPDS auto-download failed on self-signed/private-CA servers — native download_file (rustls) needs skipSslVerification like the manual path (#2900)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9066b80b-3cb5-44df-9c4b-7f609cf285a5
---

Issue #4988: OPDS auto-download failed while manual browse/download of the same catalog worked (reporter: iPad + Calibre-Web NextGen behind nginx https). Reporter blamed the credential-less HEAD probes — red herring: those are `probeAuth` challenge probes, their 401 is by design and the Basic header still reaches the GET.

**Real signature:** feed GETs and HEAD probes appear in the server log, download GETs never do → the native `download_file` dies client-side in the TLS handshake. The Tauri http-plugin path (`opdsReq.ts`) always passes `danger: {acceptInvalidCerts: true}`, but `transfer_file.rs` builds its reqwest client with **rustls**, which ignores the OS trust store — self-signed, private-CA, or incomplete-chain certs all fail unless `skip_ssl_verification` is set. Manual download (`page.tsx handleDownload`) got `skipSslVerification: true` in #2900 (for #2871); `autoDownload.ts downloadAndImport` never did.

**Fix (2026-07-08, PR #5002):** pass `skipSslVerification: true` in autoDownload's `downloadFile` call. Test in `opds-auto-download.test.ts`.

**How to apply:** any new code path that downloads via native `download_file`/`tauriDownload` from a user-configured server must mirror the manual path's `skipSslVerification` — TLS behavior differs between the http plugin (danger flags on) and transfer_file (strict rustls by default), so "browse works but download fails, nothing in server logs" = check this first. "curl works without -k" on another machine proves nothing about rustls trust.
