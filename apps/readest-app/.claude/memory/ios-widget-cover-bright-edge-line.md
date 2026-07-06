---
name: ios-widget-cover-bright-edge-line
description: iOS reading widget cover sometimes had a bright hairline at the right edge from fractional resize; round target to whole pixels
metadata: 
  node_type: memory
  type: project
  originSessionId: fc6acdd3-a3d1-4823-a5c4-7fe75686fc93
---

iOS reading-widget book covers sometimes showed a **bright hairline along the right edge** (Android widget never did). Fixed in PR #4950, `src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/ReadingWidgetWriter.swift` `writeThumbnail`.

**Root cause:** the downsample target was fractional:
`CGSize(width: image.size.width * scale, height: image.size.height * scale)` with `scale = 240 / longEdge`. For portrait covers the height (longEdge) lands on a whole pixel but the width is fractional. `UIGraphicsImageRenderer` allocates a **whole-pixel** buffer (rounds the size up), while `image.draw(in:)` fills only the exact fractional rect — so when the fractional width rounds *up*, the rightmost pixel column is only partially covered → **semi-transparent** (e.g. alpha 225 instead of 255). `jpegData` has no alpha, so that column flattens to a visible bright line. Intermittent ("sometimes") because it only bites when the fractional part rounds up; portrait-specific because width is the fractional edge.

**Fix:** round both dimensions to whole pixels so draw-rect == pixel-buffer and every edge pixel is fully covered:
`CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())`.

Verified with a faithful CoreGraphics repro (same rasterization as UIKit): `453x680` cover gave edge alpha `225` before, `255` after; all sizes `255` after. Android ([[mobile-reading-widgets]] `ReadingWidgetStore.kt`) is immune because it scales to a fixed integer 240x360 and center-crops.

No checked-in Swift test: the plugin `Package.swift` has no wired test target and the code is UIKit-only.
