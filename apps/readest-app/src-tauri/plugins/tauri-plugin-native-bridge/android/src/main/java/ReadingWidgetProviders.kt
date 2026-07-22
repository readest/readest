package com.readest.native_bridge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.RemoteViews
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.session.PlaybackStateCompat
import org.json.JSONObject
import java.io.File

private fun bookPendingIntent(context: Context, hash: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("readest://book/$hash"))
        .setPackage(context.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, intent, flags)
}

private fun bookAt(snapshot: JSONObject, index: Int): JSONObject? {
    val books = snapshot.optJSONArray("books") ?: return null
    return if (index < books.length()) books.optJSONObject(index) else null
}

private fun setCover(context: Context, views: RemoteViews, viewId: Int, hash: String) {
    val file = File(ReadingWidgetStore.coversDir(context), "$hash.png")
    val bitmap = if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
    if (bitmap != null) views.setImageViewBitmap(viewId, bitmap)
    else views.setImageViewResource(viewId, android.R.color.transparent)
}

class ReadingWidgetProvider : AppWidgetProvider() {
    private val coverIds = intArrayOf(R.id.cover0, R.id.cover1, R.id.cover2)

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateWidget(context, mgr, id)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context, mgr: AppWidgetManager, id: Int, newOptions: android.os.Bundle
    ) {
        updateWidget(context, mgr, id)
    }

    private fun updateWidget(context: Context, mgr: AppWidgetManager, id: Int) {
        val snapshot = ReadingWidgetStore.readSnapshot(context)
        val opts = mgr.getAppWidgetOptions(id)
        val minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
        val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        // Android grid: a span of n cells reports about (70*n - 30) dp, so
        // n = (dp + 30) / 70. One book per column, capped at 3 (1 col -> 1,
        // 2 -> 2, 3 and 4 -> 3). No header is shown, for a minimal UI.
        val cols = ((minW + 30) / 70).coerceAtLeast(1).coerceAtMost(3)
        val rows = ((minH + 30) / 70).coerceAtLeast(1)

        val views = RemoteViews(context.packageName, R.layout.widget_reading)

        val count = snapshot.optJSONArray("books")?.length() ?: 0
        if (count == 0) {
            views.setViewVisibility(R.id.empty, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.row, android.view.View.GONE)
            views.setTextViewText(R.id.empty, snapshot.optString("emptyTitle"))
        } else {
            views.setViewVisibility(R.id.empty, android.view.View.GONE)
            views.setViewVisibility(R.id.row, android.view.View.VISIBLE)
            for (i in coverIds.indices) {
                val book = if (i < cols) bookAt(snapshot, i) else null
                if (book == null) {
                    views.setViewVisibility(coverIds[i], android.view.View.GONE)
                    continue
                }
                val hash = book.optString("hash")
                setCover(context, views, coverIds[i], hash)
                views.setOnClickPendingIntent(coverIds[i], bookPendingIntent(context, hash, id * 10 + i))
                views.setViewVisibility(coverIds[i], android.view.View.VISIBLE)
            }
        }
        // Only show the TTS controls when the widget has 2+ rows (no room in a
        // single-row size). Add a little top padding in that case to balance the
        // bottom control bar.
        val tts = snapshot.optJSONObject("tts")
        if (tts != null && tts.optBoolean("active") && rows >= 2) {
            views.setViewVisibility(R.id.tts_bar, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.top_spacer, android.view.View.VISIBLE)
            val playing = tts.optBoolean("playing")
            views.setImageViewResource(
                R.id.btn_play_pause,
                if (playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
            )
            views.setOnClickPendingIntent(
                R.id.btn_prev,
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    context, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                )
            )
            views.setOnClickPendingIntent(
                R.id.btn_play_pause,
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    context, PlaybackStateCompat.ACTION_PLAY_PAUSE
                )
            )
            views.setOnClickPendingIntent(
                R.id.btn_next,
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    context, PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                )
            )
        } else {
            views.setViewVisibility(R.id.tts_bar, android.view.View.GONE)
            views.setViewVisibility(R.id.top_spacer, android.view.View.GONE)
        }
        mgr.updateAppWidget(id, views)
    }
}
