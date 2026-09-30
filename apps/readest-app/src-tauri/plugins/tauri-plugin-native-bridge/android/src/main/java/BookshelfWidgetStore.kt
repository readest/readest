package com.readest.native_bridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import com.readest.native_bridge.WidgetImageUtils.THUMB_HEIGHT
import com.readest.native_bridge.WidgetImageUtils.THUMB_WIDTH
import org.json.JSONObject
import java.io.File

/** One placed widget's choices from BookshelfWidgetConfigureActivity. `shelfId`
 * names one of the app's bookshelves; the app resolves it (falling back to
 * Recently read) when it publishes the widget's snapshot. */
data class BookshelfWidgetInstanceSettings(
    val shelfId: String = BookshelfWidgetStore.DEFAULT_SHELF_ID,
    val gridRows: Int = BookshelfWidgetStore.DEFAULT_GRID_ROWS,
    val gridColumns: Int = BookshelfWidgetStore.DEFAULT_GRID_COLUMNS,
    val showTitles: Boolean = false,
    val showShelfName: Boolean = false,
    val headerSize: Int = DEFAULT_HEADER_SIZE,
    val showTtsBar: Boolean = true,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("shelfId", shelfId)
        .put("gridRows", gridRows)
        .put("gridColumns", gridColumns)
        .put("showTitles", showTitles)
        .put("showShelfName", showShelfName)
        .put("headerSize", headerSize)
        .put("showTtsBar", showTtsBar)

    companion object {
        fun fromJson(json: JSONObject): BookshelfWidgetInstanceSettings {
            val defaults = BookshelfWidgetInstanceSettings()
            return BookshelfWidgetInstanceSettings(
                shelfId = json.optString("shelfId", defaults.shelfId),
                gridRows = json.optInt("gridRows", defaults.gridRows),
                gridColumns = json.optInt("gridColumns", defaults.gridColumns),
                showTitles = json.optBoolean("showTitles", defaults.showTitles),
                showShelfName = json.optBoolean("showShelfName", defaults.showShelfName),
                headerSize = json.optInt("headerSize", defaults.headerSize),
                showTtsBar = json.optBoolean("showTtsBar", defaults.showTtsBar),
            )
        }
    }
}

object BookshelfWidgetStore {
    const val PREFS = "bookshelf_widget"
    private const val KEY_SNAPSHOT_PREFIX = "snapshot_"
    private const val KEY_INSTANCE_SETTINGS_PREFIX = "instanceSettings_"
    private const val KEY_CATALOG = "catalog"

    // Smaller radius for each individual cover within a group-tile mosaic —
    // mirrors the in-app Library's GroupItem, whose mini covers use a much
    // smaller corner radius than a full-size cover.
    private const val GROUP_CELL_CORNER_RADIUS = 8f

    // Matches the widget's original fixed appearance: the app's Recently read
    // shelf in a single row of 3 columns.
    const val DEFAULT_SHELF_ID = "recent"
    const val DEFAULT_GRID_ROWS = 1
    const val DEFAULT_GRID_COLUMNS = 3

    fun coversDir(context: Context): File =
        File(context.filesDir, "widget/covers").apply { mkdirs() }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun writeStr(context: Context, prefix: String, appWidgetId: Int, value: String) {
        prefs(context).edit().putString(prefix + appWidgetId, value).apply()
    }

    fun writeThumbnail(
        context: Context,
        hash: String,
        sourcePath: String,
        percent: Int,
        showProgress: Boolean = true,
    ): Boolean {
        val dir = coversDir(context)
        val dst = File(dir, "$hash.png")
        // The hash comes from library records (cloud sync, backup restore)
        // and is used as a file name; never let it escape the covers dir.
        if (dst.canonicalFile.parentFile != dir.canonicalFile) return false
        // No skip-if-unchanged check: the composite depends on the live percent.
        val scaled = WidgetImageUtils.decodeCoverCroppedAndScaled(sourcePath, THUMB_WIDTH, THUMB_HEIGHT)
            ?: run { dst.delete(); return false }

        val rounded = WidgetImageUtils.applyRoundedCorners(scaled)
        scaled.recycle()

        // Bake progress bar and % badge into the cover bitmap — only for a book
        // actively being read; an unread or finished/abandoned book shows a
        // plain cover with no progress indicator.
        if (showProgress) {
            val canvas = Canvas(rounded)
            val w = rounded.width.toFloat()
            val h = rounded.height.toFloat()
            val pad = w * 0.05f
            val pct = percent.coerceIn(0, 100)

            // progress bar along the bottom
            val barH = w * 0.035f
            val barTop = h - pad - barH
            val barLeft = pad
            val barRight = w - pad
            val radius = barH / 2f
            val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x66000000 }
            canvas.drawRoundRect(RectF(barLeft, barTop, barRight, barTop + barH), radius, radius, trackPaint)
            val fillRight = barLeft + (barRight - barLeft) * (pct / 100f)
            if (fillRight > barLeft + radius) {
                val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF6A4BFF.toInt() }
                canvas.drawRoundRect(RectF(barLeft, barTop, fillRight, barTop + barH), radius, radius, fillPaint)
            }

            // % badge pill, top-right
            val text = "$pct%"
            val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = 0xFFFFFFFF.toInt()
                textSize = w * 0.085f
                typeface = Typeface.DEFAULT_BOLD
            }
            val fm = textPaint.fontMetrics
            val tw = textPaint.measureText(text)
            val padX = w * 0.03f
            val padY = w * 0.02f
            val pillW = tw + padX * 2f
            val pillH = (fm.descent - fm.ascent) + padY * 2f
            val pillRight = w - pad
            val pillTop = pad
            val pillLeft = pillRight - pillW
            val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xB3000000.toInt() }
            val pillR = pillH / 2f
            canvas.drawRoundRect(RectF(pillLeft, pillTop, pillRight, pillTop + pillH), pillR, pillR, pillPaint)
            canvas.drawText(text, pillLeft + padX, pillTop + padY - fm.ascent, textPaint)
        }

        // Write as PNG so the alpha channel for rounded corners is preserved.
        val ok = WidgetImageUtils.writeBitmapAtomically(dst, rounded)
        rounded.recycle()
        return ok
    }

    /**
     * Composites up to 4 covers into a 2x2 mosaic tile for the widget's
     * "browse groups" mode (mirrors the in-app Library's GroupItem tile).
     * Fewer than 4 source paths leaves the rest as a placeholder fill rather
     * than stretching to cover them. Exactly 1 source path (a group with only
     * one member) renders as a single full-size cover
     * instead, like a regular book thumbnail. Returns false when any source
     * cover could not be used, so the caller can retry once it is available.
     */
    fun writeGroupTileThumbnail(context: Context, id: String, coverPaths: List<String>): Boolean {
        val dir = coversDir(context)
        val dst = File(dir, "$id.png")
        // Same reasoning as writeThumbnail: never let the id escape the covers dir.
        if (dst.canonicalFile.parentFile != dir.canonicalFile) return false
        if (coverPaths.isEmpty()) {
            dst.delete(); return false
        }

        if (coverPaths.size == 1) {
            val single = WidgetImageUtils.decodeCoverCroppedAndScaled(coverPaths[0], THUMB_WIDTH, THUMB_HEIGHT)
                ?: run { dst.delete(); return false }
            val roundedSingle = WidgetImageUtils.applyRoundedCorners(single)
            single.recycle()
            val ok = WidgetImageUtils.writeBitmapAtomically(dst, roundedSingle)
            roundedSingle.recycle()
            return ok
        }

        val pad = 8f
        val gap = 6f
        val cellW = ((THUMB_WIDTH - pad * 2 - gap) / 2).toInt().coerceAtLeast(1)
        val cellH = ((THUMB_HEIGHT - pad * 2 - gap) / 2).toInt().coerceAtLeast(1)

        val composite = Bitmap.createBitmap(THUMB_WIDTH, THUMB_HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(composite)
        // Plain rect fill is fine here — applyRoundedCorners clips the whole
        // composite to rounded corners at the end regardless.
        val placeholderPaint = Paint().apply { color = 0x33808080 }
        canvas.drawRect(0f, 0f, THUMB_WIDTH.toFloat(), THUMB_HEIGHT.toFloat(), placeholderPaint)

        var missing = 0
        for (i in 0 until 4.coerceAtMost(coverPaths.size)) {
            val cell = WidgetImageUtils.decodeCoverCroppedAndScaled(coverPaths[i], cellW, cellH)
            if (cell == null) {
                missing++
                continue
            }
            val roundedCell = WidgetImageUtils.applyRoundedCorners(cell, GROUP_CELL_CORNER_RADIUS)
            cell.recycle()
            val left = pad + (i % 2) * (cellW + gap)
            val top = pad + (i / 2) * (cellH + gap)
            canvas.drawBitmap(roundedCell, left, top, null)
            roundedCell.recycle()
        }

        val rounded = WidgetImageUtils.applyRoundedCorners(composite)
        composite.recycle()
        val ok = WidgetImageUtils.writeBitmapAtomically(dst, rounded)
        rounded.recycle()
        return missing == 0 && ok
    }

    /** The coverKey of every group tile in a snapshot, i.e. the group-cover
     * files it owns (see writeGroupTileThumbnail/clear). */
    private fun groupCoverKeys(snapshot: JSONObject): Set<String> {
        val items = snapshot.optJSONArray("items") ?: return emptySet()
        val keys = mutableSetOf<String>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            if (item.optString("type") != "group") continue
            val coverKey = item.optString("coverKey")
            if (coverKey.isNotEmpty()) keys.add(coverKey)
        }
        return keys
    }

    private fun deleteGroupCovers(context: Context, keys: Set<String>) {
        if (keys.isEmpty()) return
        val dir = coversDir(context)
        for (key in keys) {
            // Same reasoning as the writers: never let a stored key escape the covers dir.
            val file = File(dir, "$key.png")
            if (file.canonicalFile.parentFile != dir.canonicalFile) continue
            file.delete()
        }
    }

    /** Replaces a widget's snapshot, deleting any group-cover file the previous
     * snapshot owned that the new one doesn't - e.g. a group dropped by a
     * filter change, or a groupBy change that replaces the whole tile set -
     * so it doesn't linger until the widget itself is deleted. An unparseable
     * `json` skips cleanup rather than deleting everything (it isn't stored as
     * valid JSON either way, so there's nothing to diff against); the new
     * snapshot is committed to disk (not the usual async apply - a process
     * death before it lands must not leave the still-stored old snapshot
     * pointing at an already-deleted cover) before the stale files are
     * deleted, so a death after that only leaks an orphan file. */
    fun writeSnapshot(context: Context, appWidgetId: Int, json: String) {
        val next = runCatching { JSONObject(json) }.getOrNull()
        val staleKeys = next?.let { groupCoverKeys(readSnapshot(context, appWidgetId)) - groupCoverKeys(it) }
        val committed = prefs(context).edit().putString(KEY_SNAPSHOT_PREFIX + appWidgetId, json).commit()
        notifyWidget(context, appWidgetId)
        if (committed) staleKeys?.let { deleteGroupCovers(context, it) }
    }

    fun readSnapshot(context: Context, appWidgetId: Int): JSONObject {
        val raw = prefs(context).getString(KEY_SNAPSHOT_PREFIX + appWidgetId, null)
            ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    }

    /** One JSON blob per widget: every caller needs the whole set at once. */
    fun writeInstanceSettings(context: Context, appWidgetId: Int, settings: BookshelfWidgetInstanceSettings) {
        writeStr(context, KEY_INSTANCE_SETTINGS_PREFIX, appWidgetId, settings.toJson().toString())
    }

    /** Whether this widget has been configured before, i.e. is already placed. */
    fun hasInstanceSettings(context: Context, appWidgetId: Int): Boolean =
        prefs(context).contains(KEY_INSTANCE_SETTINGS_PREFIX + appWidgetId)

    fun readInstanceSettings(context: Context, appWidgetId: Int): BookshelfWidgetInstanceSettings {
        val raw = prefs(context).getString(KEY_INSTANCE_SETTINGS_PREFIX + appWidgetId, null)
        val json = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
        return json?.let(BookshelfWidgetInstanceSettings::fromJson) ?: BookshelfWidgetInstanceSettings()
    }

    /** The shelves and translated labels the app last published for the
     * configure screen, or an empty object before the app first ran. */
    fun writeCatalog(context: Context, json: String) {
        prefs(context).edit().putString(KEY_CATALOG, json).apply()
    }

    fun readCatalog(context: Context): JSONObject {
        val raw = prefs(context).getString(KEY_CATALOG, null) ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    }

    /** Called on widget removal, so neither its snapshot, its settings, nor any
     * group-tile covers it wrote linger. Book thumbnails are named by hash and
     * shared across widgets, so only the group covers named in this widget's
     * own last snapshot (by their widget-scoped coverKey) are deleted. */
    fun clear(context: Context, appWidgetId: Int) {
        deleteGroupCovers(context, groupCoverKeys(readSnapshot(context, appWidgetId)))
        prefs(context).edit()
            .remove(KEY_SNAPSHOT_PREFIX + appWidgetId)
            .remove(KEY_INSTANCE_SETTINGS_PREFIX + appWidgetId)
            .apply()
    }

    /** Redraws just this widget, so N widgets refreshing together don't each redraw all N. */
    fun notifyWidget(context: Context, appWidgetId: Int) {
        // Null on builds without app widget support (TV, automotive).
        val mgr = AppWidgetManager.getInstance(context) ?: return
        val cls = BookshelfWidgetProvider::class.java
        if (appWidgetId !in mgr.getAppWidgetIds(ComponentName(context, cls))) return
        val intent = android.content.Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        intent.component = ComponentName(context, cls)
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
        context.sendBroadcast(intent)
    }
}
