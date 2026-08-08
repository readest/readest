---
name: store-listings-fastlane-5573
description: "Store listing rebuild (PR #5573): fastlane metadata_path traps, additive image uploads, the 6.5in iPhone slot, and why local promo folders are not the live listing"
metadata: 
  node_type: memory
  type: project
  originSessionId: c48840ad-d58b-4ef2-b4a1-0936f90ef622
  modified: 2026-08-08T05:47:07.906Z
---

MERGED #5573 (2026-08-08). Rebuilt every store screenshot and split listing
metadata so Play/F-Droid and iOS/macOS each get their own copy. Full technical
detail lives in `fastlane/metadata/README.md` in the repo; this records the
traps that cost the most time and would bite again.

**Two typos were live on both stores for months** ("beatifully organized",
"seemless text-to-speech") because captions were baked into the PNGs and the
source project was never saved locally. Captions are now live text rendered by
`fastlane/compositor/render-caption.mjs` (headless Chromium via the repo's
Playwright, using `public/fonts/InterVariable.woff2`).

**metadata_path traps, both cost a failed run:**
- `supply --metadata_path` points at the directory CONTAINING locale folders,
  so it must end in `/android`. Pointing at `fastlane/metadata-play` made supply
  read "android" as a locale; Google returned a bare "Invalid request".
- `deliver`'s metadata_path has NO platform dimension. iOS and macOS share one
  App Store Connect record, so both lanes push identical text unless each gets
  its own path.

**Image uploads are ADDITIVE by default on both stores.** Play's
`sync_image_upload` and deliver's `overwrite_screenshots` both default false, so
uploading a replacement set leaves the old one alongside it. Play's is still
false as of the merge.

**This app record only exposes a 6.5in iPhone slot** (1242x2688 or 1284x2778) and
rejects 1320x2868, even though Apple's docs describe 6.9in as current. Check the
slot in App Store Connect before resizing anything. A 6.9in set is kept in the
gitignored `fastlane/staging/iphone-6.9/`.

**`readest-promotions/` is not version controlled and is not the live listing.**
Its Play panels 1 and 2 were an unused revision carrying review cards that are
not live, differing 6-8% from what Google actually serves. Pull real assets with
`curl "https://play-lh.googleusercontent.com/<id>=s0"` (the `=s0` suffix returns
the original upload); ids come from `img[alt="Screenshot image"]` on the listing.
For Apple use the `download_store_screenshots` lane, which reads the .p8 via
`asc_api_key` (deliver's `--api_key_path` JSON demands the key CONTENTS inline,
so never take that route).

Erasing a baked caption has two failure modes, both hit: measuring the old ink in
a band that clips it, and padding the erase rectangle "for safety" into a device's
rounded corner. Always diff the device region afterwards and assert 0 changed px.

Related: [[feedback_use_worktree]], [[ci-pr-delivery-and-push]]
