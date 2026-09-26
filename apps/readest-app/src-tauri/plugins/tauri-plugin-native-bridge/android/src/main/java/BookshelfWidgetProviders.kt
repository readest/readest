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

private fun bookPendingIntent(context: Context, hash: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("readest://book/$hash"))
        .setPackage(context.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, intent, flags)
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
    pendingIntent: PendingIntent,
) {
    val file = File(BookshelfWidgetStore.coversDir(context), "$coverHash.png")
    val bitmap = if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
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

        val views = RemoteViews(context.packageName, R.layout.widget_bookshelf)

        // The heading is the instance's shelf name, which JS puts in the snapshot.
        val heading = snapshot.optString("sectionTitle")
        if (heading.isBlank()) {
            views.setViewVisibility(R.id.heading, android.view.View.GONE)
        } else {
            views.setTextViewText(R.id.heading, heading)
            views.setViewVisibility(R.id.heading, android.view.View.VISIBLE)
        }

        val tts = snapshot.optJSONObject("tts")
        // JS only includes `tts` for instances whose shelf matches the playing book.
        val showTtsBar = tts != null && tts.optBoolean("active")

        // Group tiles and book tiles share the grid, in the order JS sent them.
        val count = snapshot.optJSONArray("items")?.length() ?: 0
        if (count == 0) {
            views.setViewVisibility(R.id.empty, android.view.View.VISIBLE)
            views.setViewVisibility(R.id.grid, android.view.View.GONE)
            views.setTextViewText(R.id.empty, snapshot.optString("emptyTitle"))
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
                            coverHash = item.optString("id"),
                            titleText = item.optString("value"),
                            showTitles = showTitles,
                            pendingIntent = groupPendingIntent(
                                context,
                                item.optString("groupBy"),
                                item.optString("id"),
                                id * 100 + itemIndex
                            )
                        )
                    } else {
                        val hash = item.optString("hash")
                        bindCell(
                            context, views, coverId, titleId, cellId,
                            coverHash = hash,
                            titleText = item.optString("title"),
                            showTitles = showTitles,
                            pendingIntent = bookPendingIntent(context, hash, id * 100 + itemIndex)
                        )
                    }
                    views.setViewVisibility(cellId, android.view.View.VISIBLE)
                }
                index += itemsInRow
            }
        }
        if (showTtsBar) {
            views.setViewVisibility(R.id.tts_bar, android.view.View.VISIBLE)
            val playing = tts?.optBoolean("playing") == true
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
        }
        mgr.updateAppWidget(id, views)
    }
}
