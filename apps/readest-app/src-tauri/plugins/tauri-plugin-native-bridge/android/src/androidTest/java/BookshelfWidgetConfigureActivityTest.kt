package com.readest.native_bridge

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.widget.RadioButton
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** BookshelfWidgetConfigureActivity lists the shelves the app published and
 * answers the launcher with the user's choice. An invalid id just finishes. */
@RunWith(AndroidJUnit4::class)
class BookshelfWidgetConfigureActivityTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val id = 555002

    private fun launch() = ActivityScenario.launch<BookshelfWidgetConfigureActivity>(
        Intent(context, BookshelfWidgetConfigureActivity::class.java)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
    )

    private fun publishShelves(vararg shelves: Pair<String, String>) {
        val list = JSONArray()
        for ((shelfId, name) in shelves) list.put(JSONObject().put("id", shelfId).put("name", name))
        BookshelfWidgetStore.writeCatalog(context, JSONObject().put("shelves", list).toString())
    }

    @After
    fun tearDown() {
        BookshelfWidgetStore.clear(context, id)
        BookshelfWidgetStore.writeCatalog(context, "{}")
    }

    @Test
    fun savesTheChosenShelfAndAnswersOk() {
        publishShelves("recent" to "Recently read", "sf" to "Sci-fi")
        launch().use { scenario ->
            scenario.onActivity { activity ->
                val dialog = activity.dialog!!
                dialog.window!!.decorView.findViewWithTag<RadioButton>("sf").performClick()
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            }
            assertEquals(Activity.RESULT_OK, scenario.result.resultCode)
            assertEquals(id, scenario.result.resultData.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1))
            assertEquals("sf", BookshelfWidgetStore.readInstanceSettings(context, id).shelfId)
        }
    }

    @Test
    fun cancelLeavesTheSettingsAlone() {
        publishShelves("recent" to "Recently read", "sf" to "Sci-fi")
        launch().use { scenario ->
            scenario.onActivity { activity ->
                val dialog = activity.dialog!!
                dialog.window!!.decorView.findViewWithTag<RadioButton>("sf").performClick()
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick()
            }
            assertEquals(Activity.RESULT_CANCELED, scenario.result.resultCode)
            assertEquals("recent", BookshelfWidgetStore.readInstanceSettings(context, id).shelfId)
        }
    }

    @Test
    fun offersRecentlyReadBeforeTheAppPublishedAnyShelf() {
        launch().use { scenario ->
            scenario.onActivity { activity ->
                val radio = activity.dialog!!.window!!.decorView.findViewWithTag<RadioButton>("recent")
                assertEquals(true, radio.isChecked)
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
