package com.readest.native_bridge

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import java.io.File

// Clear of BookshelfWidgetProvider's per-cell request codes (id * MAX_GRID_SIZE^2 + index).
private const val REQUEST_CODE_OFFSET = 1_000_000

private val blackTextIds = listOf(
    R.id.reading_header,
    R.id.reading_empty,
    R.id.reading_title,
    R.id.reading_author,
    R.id.reading_stat_0,
    R.id.reading_stat_1,
    R.id.reading_stat_2,
)
// Offsets (sp) from the font size setting, which is the title's size.
private val textSizeOffsets = mapOf(
    R.id.reading_title to 0,
    R.id.reading_author to -3,
    R.id.reading_stat_0 to -4,
    R.id.reading_stat_1 to -4,
    R.id.reading_stat_2 to -4,
)

private class StatSlot(val text: Int, val pad: Int, val gap: Int)
private val statSlots = listOf(
    StatSlot(R.id.reading_stat_0, 0, 0),
    StatSlot(R.id.reading_stat_1, R.id.reading_stat_1_pad, R.id.reading_stat_1_gap),
    StatSlot(R.id.reading_stat_2, R.id.reading_stat_2_pad, R.id.reading_stat_2_gap),
)

class ReadingWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateWidget(context, mgr, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) ReadingWidgetStore.clear(context, id)
    }

    private fun updateWidget(context: Context, mgr: AppWidgetManager, id: Int) {
        val snapshot = ReadingWidgetStore.readSnapshot(context, id)
        val views = RemoteViews(context.packageName, R.layout.widget_reading)
        val hash = snapshot.optString("hash")

        val isEink = snapshot.optBoolean("isEink")
        val settings = ReadingWidgetStore.readInstanceSettings(context, id)
        views.setTextViewTextSize(R.id.reading_header, TypedValue.COMPLEX_UNIT_SP, settings.headerSize.toFloat())
        setHeaderGap(context, views, R.id.reading_header, settings.headerSize)
        // Space under the author (a margin can't change at runtime before Android 12) grows with the font size.
        views.setViewPadding(R.id.reading_author, 0, 0, 0, dp(context, Math.round(settings.fontSize * 0.75f)))
        for ((viewId, offset) in textSizeOffsets) {
            views.setTextViewTextSize(viewId, TypedValue.COMPLEX_UNIT_SP, (settings.fontSize + offset).toFloat())
        }

        val header = snapshot.optString("headerText")
        views.setViewVisibility(R.id.reading_header, if (header.isNotEmpty()) View.VISIBLE else View.GONE)
        if (header.isNotEmpty()) views.setTextViewText(R.id.reading_header, header)

        if (hash.isEmpty()) {
            views.setViewVisibility(R.id.reading_book_row, View.GONE)
            views.setViewVisibility(R.id.reading_empty, View.VISIBLE)
            views.setTextViewText(R.id.reading_empty, snapshot.optString("emptyTitle"))
        } else {
            views.setViewVisibility(R.id.reading_book_row, View.VISIBLE)
            views.setViewVisibility(R.id.reading_empty, View.GONE)

            val file = File(ReadingWidgetStore.coversDir(context), "$hash.png")
            val bitmap = if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
            if (bitmap != null) views.setImageViewBitmap(R.id.reading_cover, bitmap)
            else views.setImageViewResource(R.id.reading_cover, android.R.color.transparent)

            views.setTextViewText(R.id.reading_title, snapshot.optString("title"))
            views.setTextViewText(R.id.reading_author, snapshot.optString("author"))
            val percent = snapshot.optInt("percent").coerceIn(0, 100)
            views.setViewVisibility(R.id.reading_progress_bar, if (isEink) View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.reading_progress_bar_eink, if (isEink) View.VISIBLE else View.GONE)
            views.setProgressBar(
                if (isEink) R.id.reading_progress_bar_eink else R.id.reading_progress_bar,
                100, percent, false,
            )

            // Stats pack to the left with a fixed gap; a flexible gap before the last one
            // pushes it to the right edge.
            val stats = snapshot.optJSONArray("stats")
            val count = minOf(statSlots.size, stats?.length() ?: 0)
            for ((index, slot) in statSlots.withIndex()) {
                val visible = index < count
                views.setViewVisibility(slot.text, if (visible) View.VISIBLE else View.GONE)
                if (visible) views.setTextViewText(slot.text, stats!!.optString(index))
                if (index > 0) {
                    val last = index == count - 1
                    views.setViewVisibility(slot.pad, if (visible && !last) View.VISIBLE else View.GONE)
                    views.setViewVisibility(slot.gap, if (visible && last) View.VISIBLE else View.GONE)
                }
            }

            views.setOnClickPendingIntent(
                R.id.reading_book_row,
                bookPendingIntent(context, hash, id + REQUEST_CODE_OFFSET)
            )
        }

        val tts = snapshot.optJSONObject("tts")
        bindTtsBar(context, views, if (settings.showTtsBar) tts else null)
        if (isEink) {
            for (viewId in blackTextIds) views.setTextColor(viewId, Color.BLACK)
        }
        // Never let a rejected update escape: the app republishes on every launch,
        // so a crash here would repeat on every launch.
        try {
            mgr.updateAppWidget(id, views)
        } catch (e: IllegalArgumentException) {
            android.util.Log.w("ReadingWidgetProvider", "widget $id update rejected", e)
        }
    }
}
