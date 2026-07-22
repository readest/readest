package com.readest.native_bridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Instrumented test (runs on an Android device/emulator).
 *
 * Regression for the widget cover crash: a cover that decodes to exactly 2:3
 * makes the center-crop a no-op, so Bitmap.createBitmap returns the SAME
 * immutable instance as the source. The pre-fix code recycled the source right
 * after, then passed the now-recycled bitmap to createScaledBitmap, throwing
 * "cannot use a recycled source in createBitmap" and killing the app.
 */
@RunWith(AndroidJUnit4::class)
class ReadingWidgetStoreTest {
    @Test
    fun writeThumbnail_exact2to3Cover_doesNotCrash() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext

        // 240x360 is exactly 2:3 and small enough to skip downsampling, so the
        // decoded cover hits the createBitmap same-instance path.
        val src = Bitmap.createBitmap(240, 360, Bitmap.Config.ARGB_8888)
        val srcFile = File(ctx.cacheDir, "widget-cover-2x3.png")
        srcFile.outputStream().use { src.compress(Bitmap.CompressFormat.PNG, 100, it) }
        src.recycle()

        val hash = "regression2x3"
        try {
            // Pre-fix: throws IllegalArgumentException. Post-fix: writes the PNG.
            ReadingWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)

            val out = File(ReadingWidgetStore.coversDir(ctx), "$hash.png")
            assertTrue("thumbnail should be written", out.exists())
            val decoded = BitmapFactory.decodeFile(out.absolutePath)
            assertNotNull("thumbnail should decode to a valid bitmap", decoded)
            out.delete()
        } finally {
            srcFile.delete()
        }
    }
}
