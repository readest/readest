package com.readest.native_bridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.ContextThemeWrapper
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONObject

/**
 * Configure screen for the reading widget, shown when it is placed and from "Edit widget".
 * Labels come from the app's translated catalog (set_reading_widget_catalog).
 */
class ReadingWidgetConfigureActivity : Activity() {
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

        val labels = ReadingWidgetStore.readCatalog(this).optJSONObject("labels") ?: JSONObject()
        fun label(key: String, fallback: Int) = labels.optString(key).ifBlank { getString(fallback) }
        val current = ReadingWidgetStore.readInstanceSettings(this, appWidgetId)

        // Material theme for the dialog's views; see BookshelfWidgetConfigureActivity.
        val dialogContext = ContextThemeWrapper(
            this, com.google.android.material.R.style.Theme_MaterialComponents_DayNight_Dialog_Alert
        )
        val content = LinearLayout(dialogContext).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(dialogContext, 20), dp(dialogContext, 8), dp(dialogContext, 20), 0)
        }
        fun checkbox(key: String, fallback: Int, checked: Boolean) =
            MaterialCheckBox(dialogContext).apply {
                text = label(key, fallback)
                isChecked = checked
                content.addView(this)
            }
        val showHeader = checkbox("showHeader", R.string.widget_show_header, current.showHeader)
        val headerSize = intArrayOf(current.headerSize.coerceIn(MIN_TEXT_SIZE, MAX_TEXT_SIZE))
        content.addView(
            numberStepper(dialogContext, label("headerSize", R.string.widget_header_size), headerSize, MIN_TEXT_SIZE, MAX_TEXT_SIZE),
        )
        val fontSize = intArrayOf(current.fontSize.coerceIn(MIN_TEXT_SIZE, MAX_TEXT_SIZE))
        content.addView(
            numberStepper(
                dialogContext, label("textSize", R.string.widget_text_size), fontSize,
                MIN_TEXT_SIZE, MAX_TEXT_SIZE,
            ),
        )
        val showPercent = checkbox("showPercent", R.string.widget_show_percent, current.showPercent)
        val showTimeLeft = checkbox("showTimeLeft", R.string.widget_show_time_left, current.showTimeLeft)
        val showPagesRemaining =
            checkbox("showPagesRemaining", R.string.widget_show_pages_remaining, current.showPagesRemaining)
        val showPageCount = checkbox("showPageCount", R.string.widget_show_page_count, current.showPageCount)
        val referencePages = checkbox("referencePages", R.string.widget_reference_pages, current.referencePages)
        val showTtsBar = checkbox("showTtsBar", R.string.widget_show_tts_bar, current.showTtsBar)

        dialog = MaterialAlertDialogBuilder(dialogContext)
            .setTitle(label("title", R.string.reading_widget_label))
            .setView(ScrollView(dialogContext).apply { addView(content) })
            .setNegativeButton(label("cancel", android.R.string.cancel)) { _, _ -> finish() }
            .setPositiveButton(label("save", android.R.string.ok)) { _, _ ->
                ReadingWidgetStore.writeInstanceSettings(
                    this,
                    appWidgetId,
                    ReadingWidgetInstanceSettings(
                        showTimeLeft = showTimeLeft.isChecked,
                        showPageCount = showPageCount.isChecked,
                        showPagesRemaining = showPagesRemaining.isChecked,
                        showHeader = showHeader.isChecked,
                        showTtsBar = showTtsBar.isChecked,
                        referencePages = referencePages.isChecked,
                        showPercent = showPercent.isChecked,
                        fontSize = fontSize[0],
                        headerSize = headerSize[0],
                    ),
                )
                ReadingWidgetStore.notifyWidget(this, appWidgetId)
                NativeBridgePlugin.notifyWidgetConfigured()
                setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
                finish()
            }
            .setOnCancelListener { finish() }
            .show()
    }

    override fun onDestroy() {
        dialog?.dismiss()
        super.onDestroy()
    }
}
