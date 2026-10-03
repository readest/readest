package com.readest.native_bridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.readest.native_bridge.WidgetImageUtils.THUMB_HEIGHT
import com.readest.native_bridge.WidgetImageUtils.THUMB_WIDTH
import org.json.JSONObject
import java.io.File

data class ReadingWidgetInstanceSettings(
    val showTimeLeft: Boolean = false,
    val showPageCount: Boolean = true,
    val showPagesRemaining: Boolean = false,
    val showHeader: Boolean = true,
    val showPercent: Boolean = true,
    val fontSize: Int = DEFAULT_TEXT_SIZE,
    val headerSize: Int = DEFAULT_HEADER_SIZE,
    val showTtsBar: Boolean = true,
    val referencePages: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("showTimeLeft", showTimeLeft)
        .put("showPageCount", showPageCount)
        .put("showPagesRemaining", showPagesRemaining)
        .put("showHeader", showHeader)
        .put("showPercent", showPercent)
        .put("fontSize", fontSize)
        .put("headerSize", headerSize)
        .put("showTtsBar", showTtsBar)
        .put("referencePages", referencePages)

    companion object {
        fun fromJson(json: JSONObject): ReadingWidgetInstanceSettings {
            val defaults = ReadingWidgetInstanceSettings()
            return ReadingWidgetInstanceSettings(
                showTimeLeft = json.optBoolean("showTimeLeft", defaults.showTimeLeft),
                showPageCount = json.optBoolean("showPageCount", defaults.showPageCount),
                showPagesRemaining = json.optBoolean("showPagesRemaining", defaults.showPagesRemaining),
                showHeader = json.optBoolean("showHeader", defaults.showHeader),
                showPercent = json.optBoolean("showPercent", defaults.showPercent),
                fontSize = json.optInt("fontSize", defaults.fontSize),
                headerSize = json.optInt("headerSize", defaults.headerSize),
                showTtsBar = json.optBoolean("showTtsBar", defaults.showTtsBar),
                referencePages = json.optBoolean("referencePages", defaults.referencePages),
            )
        }
    }
}

object ReadingWidgetStore {
    private const val PREFS = "reading_widget"
    private const val KEY_SNAPSHOT_PREFIX = "snapshot_"
    private const val KEY_INSTANCE_SETTINGS_PREFIX = "instanceSettings_"
    private const val KEY_CATALOG = "catalog"

    // Separate from the bookshelf's dir: it bakes progress into its own "$hash.png".
    fun coversDir(context: Context): File =
        File(context.filesDir, "widget/reading_covers").apply { mkdirs() }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun writeStr(context: Context, prefix: String, appWidgetId: Int, value: String) {
        prefs(context).edit().putString(prefix + appWidgetId, value).apply()
    }

    /** Plain rounded cover; only one book is shown, so a successful write deletes the other files. */
    fun writeCover(context: Context, hash: String, sourcePath: String): Boolean {
        val dir = coversDir(context)
        val dst = File(dir, "$hash.png")
        // The hash comes from library records (cloud sync, backup restore)
        // and is used as a file name; never let it escape the covers dir.
        if (dst.canonicalFile.parentFile != dir.canonicalFile) return false
        // Every push (and every widget instance) asks for the same cover, so skip the
        // re-encode unless the source changed since the PNG was written.
        val src = File(sourcePath)
        if (src.exists() && dst.exists() && dst.lastModified() > src.lastModified()) return true
        val scaled = WidgetImageUtils.decodeCoverCroppedAndScaled(sourcePath, THUMB_WIDTH, THUMB_HEIGHT)
            ?: run { dst.delete(); return false }
        val rounded = WidgetImageUtils.applyRoundedCorners(scaled)
        scaled.recycle()
        val ok = WidgetImageUtils.writeBitmapAtomically(dst, rounded)
        rounded.recycle()
        if (ok) dir.listFiles()?.forEach { f -> if (f.name != dst.name) f.delete() }
        return ok
    }

    fun writeSnapshot(context: Context, appWidgetId: Int, json: String) {
        writeStr(context, KEY_SNAPSHOT_PREFIX, appWidgetId, json)
        notifyWidget(context, appWidgetId)
    }

    fun readSnapshot(context: Context, appWidgetId: Int): JSONObject {
        val raw = prefs(context).getString(KEY_SNAPSHOT_PREFIX + appWidgetId, null)
            ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    }

    fun writeInstanceSettings(context: Context, appWidgetId: Int, settings: ReadingWidgetInstanceSettings) {
        writeStr(context, KEY_INSTANCE_SETTINGS_PREFIX, appWidgetId, settings.toJson().toString())
    }

    fun readInstanceSettings(context: Context, appWidgetId: Int): ReadingWidgetInstanceSettings {
        val raw = prefs(context).getString(KEY_INSTANCE_SETTINGS_PREFIX + appWidgetId, null)
        val json = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
        return json?.let(ReadingWidgetInstanceSettings::fromJson) ?: ReadingWidgetInstanceSettings()
    }

    fun writeCatalog(context: Context, json: String) {
        prefs(context).edit().putString(KEY_CATALOG, json).apply()
    }

    fun readCatalog(context: Context): JSONObject {
        val raw = prefs(context).getString(KEY_CATALOG, null) ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    }

    /** Called on widget removal. The shared cover self-cleans in writeCover. */
    fun clear(context: Context, appWidgetId: Int) {
        prefs(context).edit()
            .remove(KEY_SNAPSHOT_PREFIX + appWidgetId)
            .remove(KEY_INSTANCE_SETTINGS_PREFIX + appWidgetId)
            .apply()
    }

    /** Redraws just this widget, so N widgets refreshing together don't each redraw all N. */
    fun notifyWidget(context: Context, appWidgetId: Int) {
        val mgr = AppWidgetManager.getInstance(context) ?: return
        val cls = ReadingWidgetProvider::class.java
        if (appWidgetId !in mgr.getAppWidgetIds(ComponentName(context, cls))) return
        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        intent.component = ComponentName(context, cls)
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
        context.sendBroadcast(intent)
    }
}
