---
name: pdf-theme-strip-seams
description: "Dark lines across scanned PDF pages with Apply Theme Colors + keepImages: strip seams themed by inward rounding; readest#7455 + foliate-js#155"
metadata:
  type: project
---

Found 2026-11-11 on the Xiaomi verifying #7398: FAA scan (00-80T-80) pages are 14 image strips;
`applyPageColors` rounded each kept image inward, so the seam rows took #222. Fix: join images
that meet edge to edge before rounding (foliate-js#155, b8b8de5, based on 090ccca). readest#7455
(worktree readest-fix-pdf-theme-image-seams) pins b8b8de5; MERGE AFTER #7398, then repoint to the
#155 merge commit ef650dd (MERGED 2026-11-11; contains #150/#154).

Open question for the owner: MAX_KEPT_IMAGE_COVERAGE checks each image alone, so a strip scan is
never "page-sized" and stays white in a dark theme while a single-image scan is themed.

Gotcha: in a worktree:new worktree the foliate-js submodule `origin` is the main checkout's local
module repo; push to https://github.com/readest/foliate-js.git explicitly.
Related: [[pdf-push-detail-seam-7397]]
