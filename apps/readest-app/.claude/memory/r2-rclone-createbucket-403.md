---
name: r2-rclone-createbucket-403
description: rclone copyto/moveto 403s on object-scoped R2 tokens (hidden CreateBucket probe); use a directory rclone copy
metadata: 
  node_type: memory
  type: project
  originSessionId: b0c01e3c-9485-45fe-8ae3-eb5f2762f8fa
---

Single-file `rclone copyto`/`moveto` to Cloudflare R2 first issues a **CreateBucket** probe — `PUT /<bucket>` with no object key — to "ensure the bucket exists." An **Object Read & Write** R2 token (least-privilege; can't create buckets) returns `403 AccessDenied` (a real S3 `<Error><Code>AccessDenied</Code></Error>`, with an *empty* `request id` because R2 short-circuits it). A **directory** copy `rclone copy DIR dst/` does NOT probe — it `PutObject`s the key directly → 200.

**Why it bit us:** The nightly channel (#4577) `assemble-manifest` job promoted `nightly/latest.json` via `copyto` + server-side `moveto` → 403, so the manifest was never published (build legs uploaded fine). The build legs and the stable release flow (`upload-to-r2.yml` writing `releases/latest.json`) were unaffected because they use `rclone copy DIR/`. The token had Admin earlier (build legs passed), then was narrowed to Object-R&W mid-investigation, which is when even the build-leg style would have started needing the directory form. Fixed in PR #4588.

**How to apply:** For any R2 write in CI use the directory form — `mkdir -p d && cp f d/ && rclone copy d r2:bucket/prefix/` (mirrors `upload-to-r2.yml`) — OR add `no_check_bucket = true` to the `[r2]` rclone.conf (equiv. `--s3-no-check-bucket`). R2 `PutObject` is atomic, so a `.tmp`+`moveto` "atomic promote" adds nothing over a direct write. Diagnose live with a push-triggered throwaway probe workflow (`on: push` to a feature branch — `workflow_dispatch` won't dispatch a workflow that isn't on the default branch); `rclone -vv --dump bodies` reveals `PUT /<bucket>` (CreateBucket) vs `PUT /<bucket>/<key>`.
