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

/** RemoteViews can only toggle visibility of statically declared views, not
 * create them at runtime, so the layout pre-declares a MAX_GRID_SIZE x
 * MAX_GRID_SIZE grid of cover cells up front. */
const val MAX_GRID_SIZE = 5

private val gridCoverIds = arrayOf(
    intArrayOf(R.id.cover_0_0, R.id.cover_0_1, R.id.cover_0_2, R.id.cover_0_3, R.id.cover_0_4),
    intArrayOf(R.id.cover_1_0, R.id.cover_1_1, R.id.cover_1_2, R.id.cover_1_3, R.id.cover_1_4),
    intArrayOf(R.id.cover_2_0, R.id.cover_2_1, R.id.cover_2_2, R.id.cover_2_3, R.id.cover_2_4),
    intArrayOf(R.id.cover_3_0, R.id.cover_3_1, R.id.cover_3_2, R.id.cover_3_3, R.id.cover_3_4),
    intArrayOf(R.id.cover_4_0, R.id.cover_4_1, R.id.cover_4_2, R.id.cover_4_3, R.id.cover_4_4),
)
// showTitles-on counterpart of gridCoverIds: same cover, but with an extra
// bottom margin reserving room for the title below it (see widget_bookshelf.xml
// for why). Exactly one of a cell's two covers is ever shown at a time.
private val gridCoverWithTitleIds = arrayOf(
    intArrayOf(
        R.id.cover_title_0_0, R.id.cover_title_0_1, R.id.cover_title_0_2,
        R.id.cover_title_0_3, R.id.cover_title_0_4,
    ),
    intArrayOf(
        R.id.cover_title_1_0, R.id.cover_title_1_1, R.id.cover_title_1_2,
        R.id.cover_title_1_3, R.id.cover_title_1_4,
    ),
    intArrayOf(
        R.id.cover_title_2_0, R.id.cover_title_2_1, R.id.cover_title_2_2,
        R.id.cover_title_2_3, R.id.cover_title_2_4,
    ),
    intArrayOf(
        R.id.cover_title_3_0, R.id.cover_title_3_1, R.id.cover_title_3_2,
        R.id.cover_title_3_3, R.id.cover_title_3_4,
    ),
    intArrayOf(
        R.id.cover_title_4_0, R.id.cover_title_4_1, R.id.cover_title_4_2,
        R.id.cover_title_4_3, R.id.cover_title_4_4,
    ),
)
// Each cell wraps its cover + title in a vertical container placed via
// layout_row/layout_column (see widget_bookshelf.xml); the container's own
// visibility gates the whole tile. A cell beyond the configured row/column
// count is GONE (drops out of the grid's weight sum, letting the rest
// expand); one within that range but with no book/group left is INVISIBLE
// instead, so the grid keeps its configured shape rather than shrinking to
// fewer, bigger tiles.
private val gridCellIds = arrayOf(
    intArrayOf(R.id.cell_0_0, R.id.cell_0_1, R.id.cell_0_2, R.id.cell_0_3, R.id.cell_0_4),
    intArrayOf(R.id.cell_1_0, R.id.cell_1_1, R.id.cell_1_2, R.id.cell_1_3, R.id.cell_1_4),
    intArrayOf(R.id.cell_2_0, R.id.cell_2_1, R.id.cell_2_2, R.id.cell_2_3, R.id.cell_2_4),
    intArrayOf(R.id.cell_3_0, R.id.cell_3_1, R.id.cell_3_2, R.id.cell_3_3, R.id.cell_3_4),
    intArrayOf(R.id.cell_4_0, R.id.cell_4_1, R.id.cell_4_2, R.id.cell_4_3, R.id.cell_4_4),
)
private val gridTitleIds = arrayOf(
    intArrayOf(R.id.title_0_0, R.id.title_0_1, R.id.title_0_2, R.id.title_0_3, R.id.title_0_4),
    intArrayOf(R.id.title_1_0, R.id.title_1_1, R.id.title_1_2, R.id.title_1_3, R.id.title_1_4),
    intArrayOf(R.id.title_2_0, R.id.title_2_1, R.id.title_2_2, R.id.title_2_3, R.id.title_2_4),
    intArrayOf(R.id.title_3_0, R.id.title_3_1, R.id.title_3_2, R.id.title_3_3, R.id.title_3_4),
    intArrayOf(R.id.title_4_0, R.id.title_4_1, R.id.title_4_2, R.id.title_4_3, R.id.title_4_4),
)

// internal, not private: shared with ReadingWidgetProviders.kt.
internal fun bookPendingIntent(context: Context, hash: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("readest://book/$hash"))
        .setPackage(context.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, intent, flags)
}

/** Shows the TTS transport bar (with the play/pause state) for an active session, else hides it. */
internal fun bindTtsBar(context: Context, views: RemoteViews, tts: JSONObject?) {
    if (tts == null || !tts.optBoolean("active")) {
        views.setViewVisibility(R.id.tts_bar, android.view.View.GONE)
        return
    }
    views.setViewVisibility(R.id.tts_bar, android.view.View.VISIBLE)
    views.setImageViewResource(
        R.id.btn_play_pause,
        if (tts.optBoolean("playing")) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
    )
    for ((buttonId, action) in listOf(
        R.id.btn_prev to PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
        R.id.btn_play_pause to PlaybackStateCompat.ACTION_PLAY_PAUSE,
        R.id.btn_next to PlaybackStateCompat.ACTION_SKIP_TO_NEXT,
    )) {
        views.setOnClickPendingIntent(
            buttonId, MediaButtonReceiver.buildMediaButtonPendingIntent(context, action)
        )
    }
}

/** A "browse groups" tile tap: opens the group's Library view by its id. */
private fun groupPendingIntent(
    context: Context, groupBy: String, groupId: String, requestCode: Int
): PendingIntent {
    val intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("readest://widget-group/$groupBy/${Uri.encode(groupId)}")
    ).setPackage(context.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, intent, flags)
}

/** Populates one grid cell's cover/title/tap-target - shared by the book and
 * "browse groups" branches in updateWidget, which only differ in where the
 * cover hash, title text, and tap intent come from. */
private fun bindCell(
    context: Context,
    views: RemoteViews,
    coverId: Int,
    titleId: Int,
    cellId: Int,
    coverHash: String,
    titleText: String,
    showTitles: Boolean,
    sampleSize: Int,
    pendingIntent: PendingIntent,
) {
    val file = File(BookshelfWidgetStore.coversDir(context), "$coverHash.png")
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    val bitmap = if (file.exists()) BitmapFactory.decodeFile(file.absolutePath, options) else null
    if (bitmap != null) views.setImageViewBitmap(coverId, bitmap)
    else views.setImageViewResource(coverId, android.R.color.transparent)
    if (showTitles) {
        views.setTextViewText(titleId, titleText)
        views.setViewVisibility(titleId, android.view.View.VISIBLE)
    } else {
        views.setViewVisibility(titleId, android.view.View.GONE)
    }
    views.setOnClickPendingIntent(cellId, pendingIntent)
}

class BookshelfWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateWidget(context, mgr, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) BookshelfWidgetStore.clear(context, id)
    }

    private fun updateWidget(context: Context, mgr: AppWidgetManager, id: Int) {
        val snapshot = BookshelfWidgetStore.readSnapshot(context, id)
        val settings = BookshelfWidgetStore.readInstanceSettings(context, id)
        // Always the configured preference, clamped only by MAX_GRID_SIZE -
        // never by the widget's physical size. GridLayout's weight-fill (see
        // widget_bookshelf.xml) already shrinks cells safely to fit any count,
        // and AppWidgetManager's reported size can't be trusted anyway: some
        // launchers (confirmed: Nova) report it well below the widget's
        // actual current size.
        val gridRows = settings.gridRows.coerceIn(1, MAX_GRID_SIZE)
        val gridCols = settings.gridColumns.coerceIn(1, MAX_GRID_SIZE)
        val showTitles = settings.showTitles
        // AppWidgetService rejects an update whose bitmaps exceed 6 x the
        // screen's pixel area (~4.7 MB on a 758x1024 e-ink panel); 25 full
        // 240x360 ARGB tiles are 8.6 MB, so larger grids decode at half size.
        val sampleSize = if (gridRows * gridCols > 9) 2 else 1

        val views = RemoteViews(context.packageName, R.layout.widget_bookshelf)

        // Only the app can evaluate a shelf, so a new or reconfigured widget
        // waits for it; tapping opens the app, which publishes the snapshot.
        val loaded = snapshot.optString("shelfId") == settings.shelfId

        // The heading is the shelf's name, which JS puts in the snapshot.
        val heading = snapshot.optString("sectionTitle")
        if (!loaded || !settings.showShelfName || heading.isBlank()) {
            views.setViewVisibility(R.id.heading, android.view.View.GONE)
        } else {
            views.setTextViewText(R.id.heading, heading)
            views.setTextViewTextSize(R.id.heading, android.util.TypedValue.COMPLEX_UNIT_SP, settings.headerSize.toFloat())
            setHeaderGap(context, views, R.id.heading, settings.headerSize)
            views.setViewVisibility(R.id.heading, android.view.View.VISIBLE)
        }

        // Group tiles and book tiles share the grid, in the order JS sent them.
        val count = snapshot.optJSONArray("items")?.length() ?: 0
        if (!loaded || count == 0) {
            views.setViewVisibility(R.id.empty, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.grid, android.view.View.GONE)
            views.setTextViewText(
                R.id.empty,
                if (loaded) snapshot.optString("emptyTitle") else openAppLabel(context),
            )
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                views.setOnClickPendingIntent(
                    R.id.empty,
                    PendingIntent.getActivity(context, id, it, PendingIntent.FLAG_IMMUTABLE),
                )
            }
        } else {
            views.setViewVisibility(R.id.empty, android.view.View.GONE)
            views.setViewVisibility(R.id.grid, android.view.View.VISIBLE)
            var index = 0
            for (r in gridCoverIds.indices) {
                val rowVisible = r < gridRows
                if (!rowVisible) {
                    for (c in gridCoverIds[r].indices) {
                        views.setViewVisibility(gridCellIds[r][c], android.view.View.GONE)
                    }
                    continue
                }
                val itemsInRow = (count - index).coerceIn(0, gridCols)
                for (c in gridCoverIds[r].indices) {
                    val coverId = if (showTitles) gridCoverWithTitleIds[r][c] else gridCoverIds[r][c]
                    val unusedCoverId = if (showTitles) gridCoverIds[r][c] else gridCoverWithTitleIds[r][c]
                    val cellId = gridCellIds[r][c]
                    val titleId = gridTitleIds[r][c]
                    if (c >= gridCols) {
                        views.setViewVisibility(cellId, android.view.View.GONE)
                        continue
                    }
                    val hasItem = c < itemsInRow
                    if (!hasItem) {
                        views.setViewVisibility(cellId, android.view.View.INVISIBLE)
                        continue
                    }
                    views.setViewVisibility(unusedCoverId, android.view.View.GONE)
                    views.setViewVisibility(coverId, android.view.View.VISIBLE)
                    val itemIndex = index + c
                    val item = snapshot.optJSONArray("items")?.optJSONObject(itemIndex)
                    if (item == null) {
                        views.setViewVisibility(cellId, android.view.View.GONE)
                        continue
                    }
                    if (item.optString("type") == "group") {
                        // The group's own name (series/author/tag/etc.) is the
                        // title here - mirrors the in-app Library's GroupItem label.
                        bindCell(
                            context, views, coverId, titleId, cellId,
                            // Not "id" (the real group id, used below for the tap
                            // intent): the composited cover is scoped per widget,
                            // since which members it draws from depends on this
                            // widget's own filter and mosaic setting.
                            coverHash = item.optString("coverKey"),
                            titleText = item.optString("value"),
                            showTitles = showTitles,
                            sampleSize = sampleSize,
                            pendingIntent = groupPendingIntent(
                                context,
                                item.optString("groupBy"),
                                item.optString("id"),
                                id * MAX_GRID_SIZE * MAX_GRID_SIZE + itemIndex
                            )
                        )
                    } else {
                        val hash = item.optString("hash")
                        bindCell(
                            context, views, coverId, titleId, cellId,
                            coverHash = hash,
                            titleText = item.optString("title"),
                            showTitles = showTitles,
                            sampleSize = sampleSize,
                            pendingIntent = bookPendingIntent(
                                context, hash, id * MAX_GRID_SIZE * MAX_GRID_SIZE + itemIndex
                            )
                        )
                    }
                    views.setViewVisibility(cellId, android.view.View.VISIBLE)
                }
                index += itemsInRow
            }
        }
        bindTtsBar(context, views, if (loaded && settings.showTtsBar) snapshot.optJSONObject("tts") else null)
        // Never let a rejected update escape: the app republishes on every
        // launch, so a crash here would repeat on every launch.
        try {
            mgr.updateAppWidget(id, views)
        } catch (e: IllegalArgumentException) {
            android.util.Log.w("BookshelfWidgetProvider", "widget $id update rejected", e)
        }
    }

    private fun openAppLabel(context: Context): String =
        BookshelfWidgetStore.readCatalog(context).optJSONObject("labels")?.optString("openApp")
            ?.takeIf { it.isNotBlank() }
            ?: context.getString(R.string.widget_open_app)
}
