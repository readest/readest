package com.readest.native_bridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.color.MaterialColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.MaterialAutoCompleteTextView
import com.google.android.material.textfield.TextInputLayout
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

        // The activity's own theme (Theme.Translucent, for the floating dialog
        // look) carries none of Material's attributes, so views built under it
        // render as plain platform widgets. Wrapping in a Material dialog theme
        // (DayNight, so it follows the system setting on its own) fixes that for
        // everything built from this context, matching the app's own MDC theme.
        val dialogContext = ContextThemeWrapper(
            this, com.google.android.material.R.style.Theme_MaterialComponents_DayNight_Dialog_Alert
        )

        val content = LinearLayout(dialogContext).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(dialogContext, 20), dp(dialogContext, 8), dp(dialogContext, 20), 0)
        }

        val shelfList = shelfChoices(catalog)
        val selectedShelf = shelfList.firstOrNull { it.first == current.shelfId } ?: shelfList.first()
        var selectedShelfId = selectedShelf.first
        val shelfField = TextInputLayout(
            dialogContext, null,
            com.google.android.material.R.attr.textInputOutlinedExposedDropdownMenuStyle,
        )
        val shelfDropdown = MaterialAutoCompleteTextView(shelfField.context).apply {
            tag = "shelf_dropdown"
            // A picker, not a free-text field with autocomplete: typing would
            // never update selectedShelfId, silently ignoring the user's input.
            inputType = InputType.TYPE_NULL
            keyListener = null
            setSimpleItems(shelfList.map { it.second }.toTypedArray())
            setText(selectedShelf.second, false)
            setOnItemClickListener { _, _, position, _ -> selectedShelfId = shelfList[position].first }
        }
        shelfField.addView(shelfDropdown)
        val shelfRow = LinearLayout(dialogContext).apply { gravity = Gravity.CENTER_VERTICAL }
        shelfRow.addView(
            shelfField,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        content.addView(shelfRow)
        // Opening the app cancels a first placement (the launcher drops the
        // widget), so Edit is only offered when reconfiguring a placed widget.
        // Icon-only, beside the shelf picker; contentDescription carries the label.
        // Its click listener is wired below, once the other controls exist.
        val editShelfButton = if (BookshelfWidgetStore.hasInstanceSettings(this, appWidgetId)) {
            flatButton(dialogContext).apply {
                tag = "edit_shelf"
                setIconResource(R.drawable.ic_widget_edit)
                // The vector's theme-attribute tint doesn't resolve here (white on light).
                iconTint = ColorStateList.valueOf(
                    MaterialColors.getColor(
                        dialogContext, com.google.android.material.R.attr.colorOnSurface, Color.BLACK
                    )
                )
                iconPadding = 0
                contentDescription = label("edit", R.string.widget_edit)
            }.also {
                shelfRow.addView(
                    it,
                    LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    ),
                )
            }
        } else {
            null
        }

        val showShelfName = MaterialCheckBox(dialogContext).apply {
            text = label("showShelfName", R.string.widget_show_header)
            isChecked = current.showShelfName
        }
        content.addView(showShelfName)
        val headerSize = intArrayOf(current.headerSize.coerceIn(MIN_TEXT_SIZE, MAX_TEXT_SIZE))
        content.addView(
            numberStepper(dialogContext, label("headerSize", R.string.widget_header_size), headerSize, MIN_TEXT_SIZE, MAX_TEXT_SIZE),
        )

        val rows = intArrayOf(current.gridRows.coerceIn(1, MAX_GRID_SIZE))
        val columns = intArrayOf(current.gridColumns.coerceIn(1, MAX_GRID_SIZE))
        content.addView(numberStepper(dialogContext, label("rows", R.string.widget_rows), rows, 1, MAX_GRID_SIZE))
        content.addView(numberStepper(dialogContext, label("columns", R.string.widget_columns), columns, 1, MAX_GRID_SIZE))
        val showTitles = MaterialCheckBox(dialogContext).apply {
            text = label("showTitles", R.string.widget_show_titles)
            isChecked = current.showTitles
        }
        content.addView(showTitles)
        val showTtsBar = MaterialCheckBox(dialogContext).apply {
            text = label("showTtsBar", R.string.widget_show_tts_bar)
            isChecked = current.showTtsBar
        }
        content.addView(showTtsBar)

        fun currentSettings() = BookshelfWidgetInstanceSettings(
            shelfId = selectedShelfId,
            gridRows = rows[0],
            gridColumns = columns[0],
            showTitles = showTitles.isChecked,
            showShelfName = showShelfName.isChecked,
            showTtsBar = showTtsBar.isChecked,
            headerSize = headerSize[0],
        )
        // Saves the current picks, then opens the shelf in the app's editor.
        editShelfButton?.setOnClickListener {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("readest://widget-edit-shelf/${Uri.encode(selectedShelfId)}"),
                ).setPackage(packageName),
            )
            save(appWidgetId, currentSettings())
        }

        dialog = MaterialAlertDialogBuilder(dialogContext)
            .setTitle(label("title", R.string.widget_label))
            .setView(ScrollView(dialogContext).apply { addView(content) })
            .setNegativeButton(label("cancel", android.R.string.cancel)) { _, _ -> finish() }
            .setPositiveButton(label("save", android.R.string.ok)) { _, _ -> save(appWidgetId, currentSettings()) }
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
}
