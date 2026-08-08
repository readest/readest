# Store metadata and screenshots

Single source of truth for App Store and Google Play listing copy and imagery.
Uploads are **enabled** — editing these files changes the live listings on the
next release run. See "Uploads are ENABLED" below for exactly which lanes.

## Layout

    fastlane/
      metadata/
        en-US/                        App Store text, iOS (deliver)
          name.txt                    <= 30 chars
          subtitle.txt                <= 30 chars
          keywords.txt                <= 100 chars, comma separated, no spaces
          description.txt             <= 4000 chars
          promotional_text.txt        <= 170 chars, editable without review
          {privacy,support,marketing}_url.txt
        android/en-US/                F-Droid text + plain screenshots (supply)
          title.txt                   <= 30 chars
          short_description.txt       <= 80 chars
          full_description.txt        <= 4000 chars
          changelogs/                 gitignored, generated per release
          images/
            icon.png                  512x512
            featureGraphic.png        1024x500
            phoneScreenshots/         2-8 images
            sevenInchScreenshots/     2-8 images
            tenInchScreenshots/       2-8 images
      metadata-macos/
        en-US/                        App Store text, macOS
                                      differs: subtitle, keywords, description
                                      symlinks: name.txt, *_url.txt
      metadata-play/
        android/en-US/                Google Play only (supply --metadata_path)
          title.txt                   Play ASO title; F-Droid keeps its own
          {short,full}_description.txt  symlinks into metadata/ so they cannot drift
          images/{phone,sevenInch,tenInch}Screenshots/
      screenshots/                  App Store masters, uploaded BY HAND
        ios/en-US/                    iPhone 6.5" 1284x2778 + iPad 2048x2732
        osx/en-US/                    macOS 2880x1800
      compositor/                     caption renderer (tracked)
      staging/                        gitignored scratch; nothing here is read by a lane

Play and F-Droid are deliberately split. F-Droid keeps the six plain unframed
captures and the app name "Readest"; Play gets the captioned marketing
composites and the keyword title. Upload Play with:

    fastlane supply --metadata_path fastlane/metadata-play/android ...

`deliver` infers the App Store device type from image dimensions, so filenames
under `screenshots/` only control display order.

## Target sizes

| Surface              | Size        | Notes                                   |
| -------------------- | ----------- | --------------------------------------- |
| App Store iPhone     | 1284 x 2778 | this record only exposes a 6.5" slot     |
| App Store iPad       | 2048 x 2732 | accepted by the current iPad slot        |
| Play phone           | 1242 x 2208 | 9:16; Play allows 320-3840px per side    |
| Play 7-inch tablet   | 1200 x 1920 |                                          |
| Play 10-inch tablet  | 1536 x 2048 |                                          |
| Play feature graphic | 1024 x 500  |                                          |

**Check the slot in App Store Connect before resizing anything.** Apple's docs
describe 6.9" (1320x2868) as the current iPhone size, but this app record only
offers a **6.5-inch Display** slot, which accepts 1242x2688 or 1284x2778 and
rejects 1320x2868. A 6.9" set built from the same sources is kept in
`../staging/iphone-6.9/` should the slot ever change.

## Markup

Google Play supports only `<b>`, `<i>`, `<u>` and `<br>`. `full_description.txt`
uses literal bullet characters rather than `<ul>/<li>` so the same file renders
correctly on both Play and F-Droid.

## Uploads are ENABLED

Editing these files now changes the live listings on the next release run.

- **Play** — `upload_production` uploads metadata, images, screenshots and
  changelogs from `metadata-play`, with `sync_image_upload: true` so the upload
  REPLACES the live imagery instead of adding to it. This directory is therefore
  authoritative: anything added by hand in Play Console and not mirrored here
  gets deleted on the next release. The `upload_internal` and `upload_beta` lanes
  still skip all of it on purpose: Play's listing text and imagery are
  store-level, not track-level, so uploading from a test track would rewrite the
  live production listing.
- **App Store** — `release_ios` reads `metadata/en-US`, `release_macos` reads
  `metadata-macos/en-US`. deliver's `metadata_path` has no platform dimension, so
  without the split both platforms would get identical text. With
  `skip_metadata: false` this uploads name, subtitle, keywords AND description —
  not just What's New and Promotional Text as it did before `metadata/en-US`
  existed. Promotional Text is passed inline in the Fastfile and therefore wins
  over any `promotional_text.txt`. **Screenshots are uploaded by hand in App Store
  Connect** for both platforms (`skip_screenshots: true`), so `screenshots/` is a
  master folder that no lane reads. Pull the live sets down to compare with
  `fastlane download_store_screenshots platform:osx` (or `platform:ios`).

  If this is ever automated, two traps: deliver types a screenshot purely by
  pixel size, so iOS and macOS need separate `screenshots_path` values even
  though they share one app record; and `overwrite_screenshots` defaults to
  false, so an upload ADDS to the live set rather than replacing it.

Dry-run the Play listing without committing anything (from the repo root):

    set -a && source apps/readest-app/.env.google-play.local && set +a
    fastlane supply \
      --metadata_path fastlane/metadata-play/android \
      --track production \
      --skip_upload_apk --skip_upload_aab --skip_upload_changelogs \
      --validate_only

`--validate_only` validates the edit instead of committing it, so nothing goes
live. `--skip_upload_changelogs` is required here only because changelogs attach
to a version code and this run uploads no binary; the real `upload_production`
lane uploads the AAB first, so it keeps changelogs enabled.

`scripts/release-google-play.sh` writes the Play changelog into
`metadata-play/android/en-US/changelogs/` to match `metadata_path`. Both
`changelogs/` directories are gitignored and regenerated per release.

Before this was enabled the listings were hand-maintained in each console, which
is how the Play description drifted into claiming a "semantic search" feature the
app does not have.

## Rebuilding the App Store panels

`../compositor/` holds the caption renderer (raw captures live in the gitignored
`../staging/compositor/`):

- `render-caption.mjs` renders a caption to a transparent PNG through headless
  Chromium (the Playwright already in `node_modules`), using the app's own
  `public/fonts/InterVariable.woff2`. Captions are text, not baked pixels:

      node render-caption.mjs out.png <width> <fontPx> <weight> "line one
      line two"

- `raw-iphone-{3,4,5}.png` are the untouched 1320x2868 simulator captures, so
  those panels rebuild without re-shooting.

Two traps when erasing a baked caption:

1. **Measure the old ink in a band that is not itself clipping it.** A bbox that
   touches its own crop edge is a clipped measurement, not the real extent. Both
   the leftover `y` descender on ipad-2 and the ghost `g` on ipad-3 came from
   white-out rectangles sized to a clipped bbox.
2. **Do not pad the rectangle "for safety".** Devices sit close to the captions;
   generous padding squares off their rounded corners. Measure the device edge
   and stop short of it - on ipad-1 the caption's longest line ends at x=1361
   while the device starts at x=1343, so it needs stepped bands, not one rect.

Always verify afterwards that no device pixels changed:

    magick old.png new.png -compose Difference -composite \
      -crop <device region> +repage -colorspace Gray -threshold 8% \
      -format "%[fx:int(w*h*mean)]\n" info:

Panel geometry at 1320x2868, using the bezel from the `app-store-screenshots`
skill (`mockup.png`, 1022x2082, screen inset L52 T46 W918 H1990 R126):

| Step | Value |
| --- | --- |
| bezel scaled to | 950px wide |
| screenshot resized to | 853x1850, corners r117 |
| screenshot placed at | +48+43 within the bezel |
| phone placed at | +185+741 on a white canvas |
| caption placed at | +0+98 (panels 3-5) |

Panels 1 and 2 are a **single spread** — one phone bleeds across the seam, so
they cannot be reshot independently. They were upscaled from 1284x2778 and only
their captions replaced. Panel 1's caption sat on the blob; the band is exactly
two flat colours (`#FFDEAD` blob, white), so it was rebuilt by masking the blob,
closing the holes the glyphs punched through it (`-morphology Close Disk:50`),
and repainting. Captions are positioned by measured ink box, not centred.

`../staging/previous-1284x2778/` keeps the superseded 6.5"/6.7" set.

### iPad panels

The iPad set kept its original 2048x2732 device captures for this release; only
the captions were replaced (same wording, both typos fixed, rendered in Inter at
145px — panel 1 at 139px so it clears the device). Panel 1's caption also crosses
the blob and was rebuilt with the same mask technique. Captions are placed by the
original ink box centre, so the composition is unchanged.

Not reshot: an iPad Pro 13-inch (M5) simulator boots at 2064x2752 (the current
App Store 13" size), but the dev `Readest.app` under
`src-tauri/gen/apple/build/arm64-sim/` was gone by then, so installing failed.
Rebuild it with `pnpm tauri ios dev` before attempting iPad captures.

`../staging/previous-ipad-2048x2732/` keeps the superseded iPad set.

### Play panels

Seeded from the **live listing**, not from local promo folders. That matters:
the copies under `readest-promotions/screenshots/google-play/` were an unused
revision — panels 1 and 2 there carry review cards that are not on the live
listing (6-8% pixel difference), while panels 3-5 matched exactly. Pull the real
assets before editing:

    # ids from img[alt="Screenshot image"] on the listing page
    curl -sL "https://play-lh.googleusercontent.com/<id>=s0" -o out.png

`=s0` returns the original upload, not a resized thumbnail. The 15 live images
are 5 phone (1242x2208), 5 seven-inch (1200x1920), 5 ten-inch (1536x2048).

Captions rebuilt with Inter at line-height 1.0, centred on the canvas at each
original caption's top: phone 87px, seven-inch 84px, ten-inch 108px. Every
device sits below its caption on these panels, so full-width bands are safe -
unlike the App Store panels, where devices sit alongside.

## Open decisions

1. **Phone frame colour is inconsistent.** Panels 1-2 carry the original black
   frame (upscaled); panels 3-5 use the skill bezel, which is gold/titanium.
   Recolouring the bezel to graphite would match, and panels 3-5 rebuild from
   their raw captures without a new capture.
