package com.readest.native_bridge

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class NativePaperRegionTest {
    // Pixel 7: the CSS viewport is 412.19 x 915.05 at 2.625, 1082 x 2402 px,
    // two pixels more than the 1080 x 2400 WebView shows.
    @Test fun clipsTheCssViewportOverhangToTheWebView() {
        assertArrayEquals(intArrayOf(0, 0, 1080, 2400),
            webViewRegion(0f, 0f, 412.19049f, 915.04761f, 2.625f, 1080, 2400))
    }

    @Test fun keepsRegionsInsideTheWebView() {
        assertArrayEquals(intArrayOf(263, 131, 525, 1050),
            webViewRegion(100f, 50f, 200f, 400f, 2.625f, 1080, 2400))
    }
}
