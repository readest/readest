package com.readest.native_bridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import org.json.JSONObject
import java.io.File
import kotlin.math.max

object ReadingWidgetStore {
    const val PREFS = "reading_widget"
    const val KEY_SNAPSHOT = "snapshot"
    private const val THUMB_WIDTH = 240
    private const val THUMB_HEIGHT = 360
    private const val CORNER_RADIUS = 18f

    fun coversDir(context: Context): File =
        File(context.filesDir, "widget/covers").apply { mkdirs() }

    fun writeThumbnail(context: Context, hash: String, sourcePath: String, percent: Int) {
        val dst = File(coversDir(context), "$hash.png")
        val src = File(sourcePath)
        if (!src.exists()) { dst.delete(); return }
        // Note: skip-if-unchanged removed because the composite depends on the live percent.

        // Bounds pre-pass for memory safety before full decode.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(sourcePath, bounds)
        val longEdge = max(bounds.outWidth, bounds.outHeight).coerceAtLeast(1)
        var sample = 1
        while (longEdge / sample > THUMB_HEIGHT * 2) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = BitmapFactory.decodeFile(sourcePath, opts) ?: return

        // Center-crop to 2:3 portrait aspect (width:height = 2:3).
        val srcW = bitmap.width
        val srcH = bitmap.height
        val cropW: Int
        val cropH: Int
        if (srcW * 3 > srcH * 2) {
            // Source is wider than 2:3 — crop the sides.
            cropH = srcH
            cropW = srcH * 2 / 3
        } else {
            // Source is taller than 2:3 — crop top/bottom.
            cropW = srcW
            cropH = srcW * 3 / 2
        }
        val cropX = (srcW - cropW) / 2
        val cropY = (srcH - cropH) / 2
        val cropped = Bitmap.createBitmap(bitmap, cropX, cropY, cropW, cropH)
        // createBitmap returns the SAME instance when the crop covers the whole
        // (immutable) source — i.e. covers already at exactly 2:3. Recycling here
        // would recycle `cropped` too and crash createScaledBitmap below with
        // "cannot use a recycled source". Mirror the scaled !== cropped guard.
        if (cropped !== bitmap) bitmap.recycle()

        // Scale the cropped bitmap to the target size.
        val scaled = Bitmap.createScaledBitmap(cropped, THUMB_WIDTH, THUMB_HEIGHT, true)
        if (scaled !== cropped) cropped.recycle()

        // Apply rounded corners by drawing through a BitmapShader onto a transparent canvas.
        val rounded = Bitmap.createBitmap(THUMB_WIDTH, THUMB_HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(rounded)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(
            RectF(0f, 0f, THUMB_WIDTH.toFloat(), THUMB_HEIGHT.toFloat()),
            CORNER_RADIUS, CORNER_RADIUS,
            paint
        )
        scaled.recycle()

        // Bake progress bar and % badge into the cover bitmap.
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

        // Write as PNG so the alpha channel for rounded corners is preserved.
        dst.outputStream().use { rounded.compress(Bitmap.CompressFormat.PNG, 100, it) }
        rounded.recycle()
    }

    fun writeSnapshot(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_SNAPSHOT, json).apply()
        notifyWidgets(context)
    }

    fun readSnapshot(context: Context): JSONObject {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SNAPSHOT, null) ?: return JSONObject()
        return runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    }

    private fun notifyWidgets(context: Context) {
        val mgr = AppWidgetManager.getInstance(context)
        val cls = ReadingWidgetProvider::class.java
        val ids = mgr.getAppWidgetIds(ComponentName(context, cls))
        if (ids.isNotEmpty()) {
            val intent = android.content.Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            intent.component = ComponentName(context, cls)
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            context.sendBroadcast(intent)
        }
    }
}
