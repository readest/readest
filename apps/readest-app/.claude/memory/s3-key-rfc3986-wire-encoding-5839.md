---
name: s3-key-rfc3986-wire-encoding-5839
description: "#5839 Qiniu Kodo S3 sync 'Authentication failed' for keys mixing ASCII ()!'* with non-ASCII: S3Provider.encodeKey leaves ()!'* raw on the wire while aws4fetch signs them as %28%29; fix = RFC 3986 encode the wire path"
metadata: 
  node_type: memory
  type: project
  originSessionId: a41f5713-7c2b-4858-8f26-e54d3cbf6ccf
  modified: 2026-08-24T15:52:45.446Z
---

Issue #5839: PR #5849 MERGED 2026-08-24 (`e6d29358c` on main, closes #5839), worktree
removed. Reporter verification on Kodo still pending (Qiniu mechanism is inferred from
the bisect, never exercised); if it reopens, check whether Kodo's key lookup is also
encoding-sensitive for objects already stored under raw `()` keys.
/ship quirks here: gstack is project-local (`.claude/skills/gstack/bin`), the section
scripts' `~/.claude/skills/gstack/bin` paths do not resolve; Codex refuses the
"think like an attacker" adversarial prompt (content filter) but runs the doc review.
S3-compatible sync to
Qiniu Kodo dies with "Authentication failed. Reconnect in Settings." mid-upload. Reporter's
own bisect: `()()` ok, `（）（）` ok, `()（）` FAILS, `测试(test)` FAILS.

Root cause (proved with a node script against aws4fetch 1.0.20): `encodeKey` in
`src/services/sync/providers/s3/S3Provider.ts` uses `encodeURIComponent`, which leaves
`! ' ( ) *` raw. aws4fetch decodes the pathname, re-encodes, then `encodeRfc3986` turns
those five into `%21 %27 %28 %29 %2A` in the canonical URI. So wire path != signed path
for EVERY key containing one of those chars. AWS / R2 / MinIO never notice because they
decode + strictly re-encode the received path (R2 verified: HEAD 404 either way). Qiniu
evidently trusts the client's encoding whenever the path already contains `%`, hence only
mixed keys fail. The 403 lands on the HEAD probe in `pushBookFile` (`engine.ts:339`) ->
AUTH_FAILED -> terminal latch; the title shown in the UI is not the failing book.

Key = book TITLE (`buildBookFileName`, `layout.ts:91`, `sourceTitle || title` through
`makeSafeFilename`), so Chinese titles with `(...)` are the common trigger.

**Why:** the official AWS SDK (`@smithy/util-uri-escape` `escapeUri`) sends
`encodeURIComponent(s).replace(/[!'()*]/g, hex)` on the wire, matching the SigV4 canonical
URI exactly; Readest's `encodeKey` was the odd one out.

**How to apply:** fix is one line in `encodeKey`: add `.replace(/[!'()*]/g, c => '%' +
c.charCodeAt(0).toString(16).toUpperCase())` per segment, plus a regression test asserting
the wire pathname equals `AwsV4Signer.encodedPath`. `src/utils/r2.ts:97` has the same
`encodeKey` for `x-amz-copy-source` (R2 tolerates it; untouched). Cannot verify on Qiniu
without an account; ask the reporter to test the PR build. Related: [[sync-fixes]].
