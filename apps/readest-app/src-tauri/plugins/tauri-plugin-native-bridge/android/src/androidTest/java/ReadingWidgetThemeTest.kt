package com.readest.native_bridge

import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.ContextThemeWrapper
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReadingWidgetThemeTest {
    @Test
    fun backgroundFollowsNightModeRegardlessOfHostTheme() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Launchers can use a fixed theme even when the system configuration changes.
        for (hostTheme in listOf(android.R.style.Theme_Material_Light, android.R.style.Theme_Material)) {
            for (night in listOf(false, true, false)) {
                val config = Configuration(context.resources.configuration).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                        if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
                }
                val host = ContextThemeWrapper(context.createConfigurationContext(config), hostTheme)
                val view = RemoteViews(context.packageName, R.layout.widget_reading)
                    .apply(host, FrameLayout(host))
                val bitmap = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
                view.background.setBounds(0, 0, 40, 40)
                view.background.draw(Canvas(bitmap))
                val color = bitmap.getPixel(20, 20)
                bitmap.recycle()
                val brightness = (Color.red(color) + Color.green(color) + Color.blue(color)) / 3
                assertTrue(
                    "night=$night hostTheme=$hostTheme background=${Integer.toHexString(color)}",
                    if (night) brightness < 128 else brightness > 128
                )
            }
        }
    }
}
