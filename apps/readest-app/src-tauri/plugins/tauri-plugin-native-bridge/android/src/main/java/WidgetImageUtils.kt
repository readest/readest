package com.readest.native_bridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import java.io.File
import kotlin.math.max

/** Shared cover-bitmap helpers used by every home-screen widget's store. */
internal object WidgetImageUtils {
    const val DEFAULT_CORNER_RADIUS = 18f
    const val THUMB_WIDTH = 240
    const val THUMB_HEIGHT = 360

    /**
     * Decodes an image file, center-crops it to the given target aspect ratio,
     * and scales it to exactly targetW x targetH. Returns null for a missing,
     * undecodable, or degenerate (sub-2px either dimension) source — callers
     * treat that as "no usable cover" rather than crashing.
     */
    fun decodeCoverCroppedAndScaled(sourcePath: String, targetW: Int, targetH: Int): Bitmap? {
        val src = File(sourcePath)
        if (!src.exists()) return null

        // Bounds pre-pass for memory safety before full decode.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(sourcePath, bounds)
        val longEdge = max(bounds.outWidth, bounds.outHeight).coerceAtLeast(1)
        var sample = 1
        while (longEdge / sample > max(targetW, targetH) * 2) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = BitmapFactory.decodeFile(sourcePath, opts) ?: return null

        val srcW = bitmap.width
        val srcH = bitmap.height
        // A cover that decodes 1px tall (a 1x1 placeholder cover shipped in
        // some EPUBs, or a wide banner that inSampleSize downsamples to a
        // single row) makes cropW = srcH * targetW / targetH = 0, and
        // Bitmap.createBitmap throws "width must be > 0". A 1px-wide cover
        // crops fine but is just as useless, so reject both.
        if (srcW < 2 || srcH < 2) {
            bitmap.recycle()
            return null
        }
        val cropW: Int
        val cropH: Int
        if (srcW.toLong() * targetH > srcH.toLong() * targetW) {
            // Source is wider than the target aspect — crop the sides.
            cropH = srcH
            cropW = (srcH.toLong() * targetW / targetH).toInt()
        } else {
            // Source is taller than the target aspect — crop top/bottom.
            cropW = srcW
            cropH = (srcW.toLong() * targetH / targetW).toInt()
        }
        val cropX = (srcW - cropW) / 2
        val cropY = (srcH - cropH) / 2
        val cropped = Bitmap.createBitmap(bitmap, cropX, cropY, cropW, cropH)
        // createBitmap returns the SAME instance when the crop covers the whole
        // (immutable) source — i.e. covers already at exactly the target aspect.
        // Recycling here would recycle `cropped` too and crash
        // createScaledBitmap below with "cannot use a recycled source".
        if (cropped !== bitmap) bitmap.recycle()

        val scaled = Bitmap.createScaledBitmap(cropped, targetW, targetH, true)
        if (scaled !== cropped) cropped.recycle()
        return scaled
    }

    /** Draws `source` through a BitmapShader onto a transparent canvas of the
     * same size, clipped to a rounded rect — the shared rounded-corner finish
     * for a single book cover, a composited group-tile mosaic, and (with a
     * smaller radius) each individual cover within that mosaic. */
    fun applyRoundedCorners(source: Bitmap, radius: Float = DEFAULT_CORNER_RADIUS): Bitmap {
        val rounded = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(rounded)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(
            RectF(0f, 0f, source.width.toFloat(), source.height.toFloat()),
            radius, radius,
            paint
        )
        return rounded
    }

    /** Writes `dst` atomically: encodes into a uniquely-named temp file in the
     * same directory, then renames it over the destination, so a reader (or a
     * second writer - e.g. two widgets sharing a book's cover) never sees a
     * partially-written file, and two concurrent writes never tear into one file.
     * Returns false - always cleaning up the temp file - if encoding or the
     * rename fails, so the caller can report the tile as failed and retry. */
    fun writeBitmapAtomically(dst: File, bitmap: Bitmap): Boolean {
        val tmp = File(dst.parentFile, "${dst.name}.${System.nanoTime()}.tmp")
        val encoded = try {
            tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } catch (e: Exception) {
            false
        }
        if (!encoded || !tmp.renameTo(dst)) {
            tmp.delete()
            return false
        }
        return true
    }
}
