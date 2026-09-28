package com.readest.native_bridge

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/**
 * Configure screen for the bookshelf widget, shown when it is placed and from
 * "Edit widget": pick one of the app's bookshelves (published by the app, see
 * set_bookshelf_widget_catalog), the grid size and whether to show titles.
 * The app draws the shelf the next time it runs, or right away when running.
 */
class BookshelfWidgetConfigureActivity : Activity() {
    internal var dialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        val catalog = BookshelfWidgetStore.readCatalog(this)
        val labels = catalog.optJSONObject("labels") ?: JSONObject()
        fun label(key: String, fallback: Int) = labels.optString(key).ifBlank { getString(fallback) }
        val current = BookshelfWidgetStore.readInstanceSettings(this, appWidgetId)

        val dp = resources.displayMetrics.density
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * dp).toInt(), (8 * dp).toInt(), (20 * dp).toInt(), 0)
        }

        val shelves = RadioGroup(this)
        for ((id, name) in shelfChoices(catalog)) {
            shelves.addView(RadioButton(this).apply {
                this.id = View.generateViewId()
                text = name
                tag = id
                isChecked = id == current.shelfId
            })
        }
        if (shelves.checkedRadioButtonId == View.NO_ID) {
            (shelves.getChildAt(0) as RadioButton).isChecked = true
        }
        content.addView(shelves)

        val rows = intArrayOf(current.gridRows.coerceIn(1, MAX_GRID_SIZE))
        val columns = intArrayOf(current.gridColumns.coerceIn(1, MAX_GRID_SIZE))
        content.addView(stepper(label("rows", R.string.widget_rows), rows))
        content.addView(stepper(label("columns", R.string.widget_columns), columns))
        val showTitles = CheckBox(this).apply {
            text = label("showTitles", R.string.widget_show_titles)
            isChecked = current.showTitles
        }
        content.addView(showTitles)

        val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
            Configuration.UI_MODE_NIGHT_YES
        val theme = if (night) {
            android.R.style.Theme_DeviceDefault_Dialog_Alert
        } else {
            android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        }
        dialog = AlertDialog.Builder(this, theme)
            .setTitle(label("title", R.string.widget_label))
            .setView(ScrollView(this).apply { addView(content) })
            .setNegativeButton(label("cancel", android.R.string.cancel)) { _, _ -> finish() }
            .setPositiveButton(label("save", android.R.string.ok)) { _, _ ->
                val checked = shelves.findViewById<RadioButton>(shelves.checkedRadioButtonId)
                save(
                    appWidgetId,
                    BookshelfWidgetInstanceSettings(
                        shelfId = checked.tag as String,
                        gridRows = rows[0],
                        gridColumns = columns[0],
                        showTitles = showTitles.isChecked,
                    ),
                )
            }
            .setOnCancelListener { finish() }
            .show()
    }

    override fun onDestroy() {
        dialog?.dismiss()
        super.onDestroy()
    }

    private fun save(appWidgetId: Int, settings: BookshelfWidgetInstanceSettings) {
        BookshelfWidgetStore.writeInstanceSettings(this, appWidgetId, settings)
        BookshelfWidgetStore.notifyWidget(this, appWidgetId)
        NativeBridgePlugin.notifyWidgetConfigured()
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        finish()
    }

    /** The app's shelves in Library order, or just Recently read before the
     * app has published them. */
    private fun shelfChoices(catalog: JSONObject): List<Pair<String, String>> {
        val shelves = catalog.optJSONArray("shelves")
        val choices = (0 until (shelves?.length() ?: 0)).mapNotNull { i ->
            val shelf = shelves?.optJSONObject(i) ?: return@mapNotNull null
            val id = shelf.optString("id")
            if (id.isEmpty()) null else id to shelf.optString("name", id)
        }
        return choices.ifEmpty {
            listOf(BookshelfWidgetStore.DEFAULT_SHELF_ID to getString(R.string.widget_default_shelf))
        }
    }

    /** A "label  -  n  +" row editing value[0] within 1..MAX_GRID_SIZE. */
    private fun stepper(label: String, value: IntArray): View {
        val count = TextView(this).apply {
            text = value[0].toString()
            gravity = Gravity.CENTER
            minEms = 2
        }
        fun button(sign: String, delta: Int) =
            Button(this, null, android.R.attr.borderlessButtonStyle).apply {
                text = sign
                setOnClickListener {
                    value[0] = (value[0] + delta).coerceIn(1, MAX_GRID_SIZE)
                    count.text = value[0].toString()
                }
            }
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(
                TextView(this@BookshelfWidgetConfigureActivity).apply { text = label },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
            )
            addView(button("−", -1))
            addView(count)
            addView(button("+", 1))
        }
    }
}
