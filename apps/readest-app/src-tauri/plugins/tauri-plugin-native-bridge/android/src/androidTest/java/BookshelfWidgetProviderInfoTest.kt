package com.readest.native_bridge

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression for the widget's long-press "Widget settings" entry going missing:
 * launchers only keep offering reconfigure after initial placement when the
 * provider declares WIDGET_FEATURE_RECONFIGURABLE (API 31+), which is separate
 * from declaring android:configure (used only for the initial-placement setup).
 */
@RunWith(AndroidJUnit4::class)
class BookshelfWidgetProviderInfoTest {
    @Test
    fun declaresReconfigurableWidgetFeature() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = AppWidgetManager.getInstance(context)
        val info = manager.installedProviders.firstOrNull {
            it.provider.className == ReadingWidgetProvider::class.java.name
        }
        assertNotNull("ReadingWidgetProvider should be registered under its shipped name", info)
        assertTrue(
            "widgetFeatures should include WIDGET_FEATURE_RECONFIGURABLE so launchers keep " +
                "offering 'Widget settings' after initial placement",
            (info!!.widgetFeatures and AppWidgetProviderInfo.WIDGET_FEATURE_RECONFIGURABLE) != 0
        )
    }
}
