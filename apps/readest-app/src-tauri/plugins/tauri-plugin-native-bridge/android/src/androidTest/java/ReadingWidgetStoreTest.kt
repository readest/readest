package com.readest.native_bridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Instrumented tests for the reading widget thumbnail writer (run on an
 * Android device/emulator via connectedAndroidTest).
 */
@RunWith(AndroidJUnit4::class)
class ReadingWidgetStoreTest {
    private val ctx: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    /** Encodes a w x h ARGB bitmap as a PNG in cacheDir and returns the file. */
    private fun writeCoverPng(w: Int, h: Int, name: String): File {
        val src = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val file = File(ctx.cacheDir, name)
        file.outputStream().use { src.compress(Bitmap.CompressFormat.PNG, 100, it) }
        src.recycle()
        return file
    }

    private fun thumbnailFile(hash: String) = File(ReadingWidgetStore.coversDir(ctx), "$hash.png")

    /** Asserts the thumbnail exists and decodes to the 240x360 widget size. */
    private fun assertThumbnailWritten(hash: String) {
        val out = thumbnailFile(hash)
        assertTrue("thumbnail should be written", out.exists())
        val decoded = checkNotNull(BitmapFactory.decodeFile(out.absolutePath)) {
            "thumbnail should decode to a valid bitmap"
        }
        assertEquals(240, decoded.width)
        assertEquals(360, decoded.height)
    }

    /**
     * Regression for the widget cover crash: a cover that decodes to exactly 2:3
     * makes the center-crop a no-op, so Bitmap.createBitmap returns the SAME
     * immutable instance as the source. The pre-fix code recycled the source right
     * after, then passed the now-recycled bitmap to createScaledBitmap, throwing
     * "cannot use a recycled source in createBitmap" and killing the app.
     */
    @Test
    fun writeThumbnail_exact2to3Cover_doesNotCrash() {
        // 240x360 is exactly 2:3 and small enough to skip downsampling, so the
        // decoded cover hits the createBitmap same-instance path.
        val srcFile = writeCoverPng(240, 360, "widget-cover-2x3.png")
        val hash = "regression2x3"
        try {
            // Pre-fix: throws IllegalArgumentException. Post-fix: writes the PNG.
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertThumbnailWritten(hash)
        } finally {
            srcFile.delete()
            thumbnailFile(hash).delete()
        }
    }

    /**
     * Regression for the launch crash on covers that decode 1px tall, here a
     * 1x1 placeholder cover as shipped in some EPUBs. The 2:3 center-crop
     * computed cropW = srcH * 2 / 3 = 0, and Bitmap.createBitmap threw
     * "width must be > 0" out of the widget coroutine, killing the app on
     * every launch since the widget snapshot is republished on library load.
     */
    @Test
    fun writeThumbnail_1x1Cover_doesNotCrashAndDropsStaleThumbnail() {
        val srcFile = writeCoverPng(1, 1, "widget-cover-1x1.png")
        val hash = "regression1x1"
        val out = thumbnailFile(hash)
        // A stale thumbnail from an earlier, valid cover must not survive.
        out.writeBytes(byteArrayOf(1, 2, 3))
        try {
            // Pre-fix: throws IllegalArgumentException("width must be > 0").
            // Post-fix: returns without writing; a 1px cover is not a cover.
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertFalse("degenerate cover should not leave a thumbnail", out.exists())
        } finally {
            srcFile.delete()
            out.delete()
        }
    }

    /**
     * The same crash reached through the bounds pre-pass: a 2000x4 banner gets
     * inSampleSize 4 and decodes to 500x1, so the guard has to look at the
     * decoded size rather than the file's declared size.
     */
    @Test
    fun writeThumbnail_wideBannerDownsampledTo1pxTall_dropsStaleThumbnail() {
        val srcFile = writeCoverPng(2000, 4, "widget-cover-banner.png")
        val hash = "regressionbanner"
        val out = thumbnailFile(hash)
        out.writeBytes(byteArrayOf(1, 2, 3))
        try {
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertFalse("1px-tall decode should not leave a thumbnail", out.exists())
        } finally {
            srcFile.delete()
            out.delete()
        }
    }

    /** 3x2 is the smallest accepted size: it crops to 1x2 (cropW = 2 * 2 / 3 = 1) and must still scale up. */
    @Test
    fun writeThumbnail_smallestAcceptedCover_writesThumbnail() {
        val srcFile = writeCoverPng(3, 2, "widget-cover-3x2.png")
        val hash = "boundary3x2"
        try {
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertThumbnailWritten(hash)
        } finally {
            srcFile.delete()
            thumbnailFile(hash).delete()
        }
    }

    /** Taller than 2:3 takes the crop-top-and-bottom branch and still lands at 240x360. */
    @Test
    fun writeThumbnail_tallCover_cropsToWidgetSize() {
        val srcFile = writeCoverPng(300, 900, "widget-cover-tall.png")
        val hash = "tall300x900"
        try {
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertThumbnailWritten(hash)
        } finally {
            srcFile.delete()
            thumbnailFile(hash).delete()
        }
    }

    /** A cover file that exists but is not an image drops the stale thumbnail, like a missing one. */
    @Test
    fun writeThumbnail_undecodableCover_dropsStaleThumbnail() {
        val srcFile = File(ctx.cacheDir, "widget-cover-not-an-image.png")
        srcFile.writeText("<html>not an image</html>")
        val hash = "undecodable"
        val out = thumbnailFile(hash)
        out.writeBytes(byteArrayOf(1, 2, 3))
        try {
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertFalse("undecodable cover should drop the stale thumbnail", out.exists())
        } finally {
            srcFile.delete()
            out.delete()
        }
    }

    /** A hash that tries to escape the covers dir is ignored: nothing is written or deleted outside it. */
    @Test
    fun writeThumbnail_hashEscapingCoversDir_isIgnored() {
        val srcFile = writeCoverPng(240, 360, "widget-cover-escape.png")
        val coversDir = ReadingWidgetStore.coversDir(ctx)
        val outside = File(coversDir.parentFile, "escaped.png")
        outside.writeBytes(byteArrayOf(1, 2, 3))
        try {
            ReadingWidgetStore.writeThumbnail(ctx, "../escaped", srcFile.absolutePath, 42)
            assertTrue("file outside the covers dir must be left alone", outside.exists())
            assertEquals(3, outside.length())
        } finally {
            srcFile.delete()
            outside.delete()
        }
    }

    /** A cover file that no longer exists drops the stale thumbnail instead of throwing. */
    @Test
    fun writeThumbnail_missingCover_dropsStaleThumbnail() {
        val hash = "missingcover"
        val out = thumbnailFile(hash)
        out.writeBytes(byteArrayOf(1, 2, 3))
        try {
            val missing = File(ctx.cacheDir, "widget-cover-does-not-exist.png").absolutePath
            ReadingWidgetStore.writeThumbnail(ctx, hash, missing, 42)
            assertFalse("missing cover should drop the stale thumbnail", out.exists())
        } finally {
            out.delete()
        }
    }
}
