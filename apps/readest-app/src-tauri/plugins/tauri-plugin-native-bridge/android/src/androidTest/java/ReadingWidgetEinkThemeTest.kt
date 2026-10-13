package com.readest.native_bridge

import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import android.view.ContextThemeWrapper
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReadingWidgetEinkThemeTest {
    private fun brightness(color: Int) = (Color.red(color) + Color.green(color) + Color.blue(color)) / 3

    @Test
    fun einkTextContrastsWithTheBackgroundInBothAppearances() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = 987_654
        ReadingWidgetStore.writeSnapshot(
            context, id, """{"hash":"eink-theme","title":"Title","author":"Author","percent":100,"isEink":true}"""
        )
        // Before Android 12 the ink is resolved in the app process, so only the
        // current system appearance can be checked.
        val currentNight = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val nights = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) listOf(false, true) else listOf(currentNight)
        try {
            for (night in nights) {
                val config = Configuration(context.resources.configuration).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                        if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
                }
                val host = ContextThemeWrapper(context.createConfigurationContext(config), android.R.style.Theme_Material_Light)
                val view = ReadingWidgetProvider.buildViews(context, id).apply(host, FrameLayout(host))
                val bitmap = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
                view.background.setBounds(0, 0, 40, 40)
                view.background.draw(Canvas(bitmap))
                val background = brightness(bitmap.getPixel(20, 20))
                // A full bar, so the fill covers the sampled pixel.
                bitmap.eraseColor(Color.TRANSPARENT)
                view.findViewById<ProgressBar>(R.id.reading_progress_bar_eink).progressDrawable.apply {
                    setBounds(0, 0, 40, 40)
                    draw(Canvas(bitmap))
                }
                val fill = brightness(bitmap.getPixel(20, 20))
                bitmap.recycle()
                val text = brightness(view.findViewById<TextView>(R.id.reading_title).currentTextColor)
                assertTrue(
                    "night=$night background=$background text=$text fill=$fill",
                    if (night) text > 200 && fill > 200 && background < 128
                    else text < 55 && fill < 55 && background > 128
                )
            }
        } finally {
            ReadingWidgetStore.clear(context, id)
        }
    }
}
