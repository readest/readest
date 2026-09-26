package com.readest.native_bridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

/** BookshelfWidgetConfigureActivity is a thin shim (see its own doc comment): it
 * opens the in-app settings and holds the launcher's request until the app saves
 * or cancels. An invalid id just finishes. */
@RunWith(AndroidJUnit4::class)
class BookshelfWidgetConfigureActivityTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun launch(id: Int) = ActivityScenario.launch<BookshelfWidgetConfigureActivity>(
        Intent(context, BookshelfWidgetConfigureActivity::class.java)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
    )

    @Test
    fun answersWithTheAppsSaveOrCancelDecision() {
        for ((saved, id, expectedCode) in listOf(
            Triple(true, 555002, Activity.RESULT_OK),
            Triple(false, 555003, Activity.RESULT_CANCELED),
        )) {
            launch(id).use { scenario ->
                assertNotEquals(Lifecycle.State.DESTROYED, scenario.state)
                BookshelfWidgetConfigureActivity.finishPending(saved)
                assertEquals("saved=$saved", expectedCode, scenario.result.resultCode)
                if (saved) {
                    assertEquals(
                        id,
                        scenario.result.resultData.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1),
                    )
                }
            }
        }
    }

    @Test
    fun finishesImmediatelyWithoutCrashingWhenAppWidgetIdIsMissing() {
        val intent = Intent(context, BookshelfWidgetConfigureActivity::class.java)
        ActivityScenario.launch<BookshelfWidgetConfigureActivity>(intent).use { scenario ->
            assertEquals(Lifecycle.State.DESTROYED, scenario.state)
        }
    }
}
