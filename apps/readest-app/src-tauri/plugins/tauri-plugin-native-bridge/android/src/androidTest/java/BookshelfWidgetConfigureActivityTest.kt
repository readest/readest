package com.readest.native_bridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.view.View
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.material.textfield.MaterialAutoCompleteTextView
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

    private fun intent() = Intent(context, BookshelfWidgetConfigureActivity::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)

    private fun launch() = ActivityScenario.launch<BookshelfWidgetConfigureActivity>(intent())

    // Reading `scenario.result` needs the activity started for a result.
    private fun launchForResult() =
        ActivityScenario.launchActivityForResult<BookshelfWidgetConfigureActivity>(intent())

    private fun publishShelves(vararg shelves: Pair<String, String>) {
        val list = JSONArray()
        for ((shelfId, name) in shelves) list.put(JSONObject().put("id", shelfId).put("name", name))
        BookshelfWidgetStore.writeCatalog(context, JSONObject().put("shelves", list).toString())
    }

    /** Simulates picking the item at `position` from the dropdown's popup list,
     * without driving the actual popup window (a separate window from the
     * dialog's, so it isn't reachable via decorView lookups). */
    private fun AlertDialog.pickShelf(position: Int) {
        val dropdown = window!!.decorView.findViewWithTag<MaterialAutoCompleteTextView>("shelf_dropdown")
        dropdown.onItemClickListener?.onItemClick(null, dropdown, position, 0)
    }

    @After
    fun tearDown() {
        BookshelfWidgetStore.clear(context, id)
        BookshelfWidgetStore.writeCatalog(context, "{}")
    }

    @Test
    fun savesTheChosenShelfAndAnswersOk() {
        publishShelves("recent" to "Recently read", "sf" to "Sci-fi")
        launchForResult().use { scenario ->
            scenario.onActivity { activity ->
                val dialog = activity.dialog!!
                dialog.pickShelf(1) // "Sci-fi"
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
        launchForResult().use { scenario ->
            scenario.onActivity { activity ->
                val dialog = activity.dialog!!
                dialog.pickShelf(1) // "Sci-fi"
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
                val dropdown = activity.dialog!!.window!!.decorView
                    .findViewWithTag<MaterialAutoCompleteTextView>("shelf_dropdown")
                assertEquals(activity.getString(R.string.widget_default_shelf), dropdown.text.toString())
            }
        }
    }

    // Opening the app from a first placement cancels it, so Edit is only
    // offered once the widget has been saved (i.e. when reconfiguring it).
    @Test
    fun offersEditOnlyWhenReconfiguringAPlacedWidget() {
        launch().use { scenario ->
            scenario.onActivity { activity ->
                val edit = activity.dialog!!.window!!.decorView.findViewWithTag<View>("edit_shelf")
                assertEquals(null, edit)
            }
        }
        BookshelfWidgetStore.writeInstanceSettings(context, id, BookshelfWidgetInstanceSettings())
        launch().use { scenario ->
            scenario.onActivity { activity ->
                val edit = activity.dialog!!.window!!.decorView.findViewWithTag<View>("edit_shelf")
                assertEquals(View.VISIBLE, edit.visibility)
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
