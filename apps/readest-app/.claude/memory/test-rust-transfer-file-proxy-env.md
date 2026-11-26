---
name: test-rust-transfer-file-proxy-env
description: pnpm test:rust fails 10 transfer_file tests (IncompleteMessage to 127.0.0.1) when the shell exports http_proxy; run it with the proxy vars unset
metadata:
  node_type: memory
  type: reference
  originSessionId: 501a9ec1-5fb6-45a8-912a-e2c21ace66c7
  modified: 2026-11-26T11:16:16.975Z
---

On 2026-11-26, `pnpm test:rust` on this Mac failed 10 `transfer_file::tests::*` tests. Each request to the test's local server failed: `reqwest::Error { url: "http://127.0.0.1:<port>/book", source: ... IncompleteMessage }`, or a timeout. The shell exports `http_proxy`/`https_proxy` (Privoxy, see [[deploy-workers-dev-sni-proxy]]). reqwest honors them, so even loopback requests go through the proxy.

The same tree passes all 217 tests with:
```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY pnpm test:rust
```
CI has no proxy and passes.

The tests could build their client with `.no_proxy()`; nobody has filed that yet. Same family as curl needing `--noproxy '*'` for localhost.
