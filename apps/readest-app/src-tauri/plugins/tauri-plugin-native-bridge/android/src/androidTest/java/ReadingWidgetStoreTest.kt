package com.readest.native_bridge

import android.content.Context
import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Instrumented tests for the reading widget cover writer (run via connectedAndroidTest). */
@RunWith(AndroidJUnit4::class)
class ReadingWidgetStoreTest {
    private val ctx: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun writeCoverPng(name: String): File {
        val bitmap = Bitmap.createBitmap(240, 360, Bitmap.Config.ARGB_8888)
        val file = File(ctx.cacheDir, name)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        return file
    }

    @Test
    fun writeCover_skipsTheReencodeUntilTheSourceIsNewer() {
        val hash = "reading-cover-skip"
        val src = writeCoverPng("$hash-src.png")
        val dst = File(ReadingWidgetStore.coversDir(ctx), "$hash.png")
        dst.delete()

        assertTrue(ReadingWidgetStore.writeCover(ctx, hash, src.absolutePath))
        assertTrue(dst.exists())

        // A newer PNG than the source is reused, not rewritten.
        val marker = src.lastModified() + 10_000
        assertTrue(dst.setLastModified(marker))
        assertTrue(ReadingWidgetStore.writeCover(ctx, hash, src.absolutePath))
        assertEquals(marker, dst.lastModified())

        // A source touched after the PNG forces a rewrite.
        assertTrue(src.setLastModified(marker + 10_000))
        assertTrue(ReadingWidgetStore.writeCover(ctx, hash, src.absolutePath))
        assertTrue(dst.lastModified() != marker)
    }

    @Test
    fun writeCover_failsAndDropsTheStalePngWhenTheSourceIsGone() {
        val hash = "reading-cover-gone"
        val src = writeCoverPng("$hash-src.png")
        assertTrue(ReadingWidgetStore.writeCover(ctx, hash, src.absolutePath))
        src.delete()

        assertFalse(ReadingWidgetStore.writeCover(ctx, hash, src.absolutePath))
        assertFalse(File(ReadingWidgetStore.coversDir(ctx), "$hash.png").exists())
    }

    @Test
    fun instanceSettings_defaultToRemainingTimeAndPagesOff() {
        val defaults = ReadingWidgetStore.readInstanceSettings(ctx, appWidgetId = -12345)
        assertFalse(defaults.showTimeLeft)
        assertFalse(defaults.showPagesRemaining)
        assertTrue(defaults.showPercent && defaults.showPageCount && defaults.showHeader)
    }
}
