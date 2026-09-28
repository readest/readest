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
 * Instrumented tests for the bookshelf widget thumbnail writer (run on an
 * Android device/emulator via connectedAndroidTest).
 */
@RunWith(AndroidJUnit4::class)
class BookshelfWidgetStoreTest {
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

    private fun thumbnailFile(hash: String) = File(BookshelfWidgetStore.coversDir(ctx), "$hash.png")
    private fun groupTileFile(id: String) = File(BookshelfWidgetStore.coversDir(ctx), "$id.png")

    /** Asserts the thumbnail/group tile exists and decodes to the 240x360 widget size. */
    private fun assertWritten(msg: String, out: File) {
        assertTrue("$msg should be written", out.exists())
        val decoded = checkNotNull(BitmapFactory.decodeFile(out.absolutePath)) {
            "$msg should decode to a valid bitmap"
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
            BookshelfWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
            assertWritten("thumbnail", thumbnailFile(hash))
        } finally {
            srcFile.delete()
            thumbnailFile(hash).delete()
        }
    }

    /**
     * Regression for the launch crash on covers that decode 1px tall: a 1x1
     * placeholder cover (as shipped in some EPUBs) hits the crash via direct
     * decode, while a 2000x4 banner hits the SAME crash via the bounds
     * pre-pass (inSampleSize 4 -> decodes to 500x1), so the guard has to look
     * at the decoded size, not the file's declared size. Both crashed with
     * "width must be > 0" out of the widget coroutine, killing the app on
     * every launch since the widget snapshot is republished on library load.
     */
    @Test
    fun writeThumbnail_1pxTallCover_doesNotCrashAndDropsStaleThumbnail() {
        for ((w, h, hash) in listOf(
            Triple(1, 1, "regression1x1"),
            Triple(2000, 4, "regressionbanner"),
        )) {
            val srcFile = writeCoverPng(w, h, "widget-cover-$hash.png")
            val out = thumbnailFile(hash)
            out.writeBytes(byteArrayOf(1, 2, 3)) // a stale thumbnail must not survive
            try {
                BookshelfWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
                assertFalse("$hash: degenerate cover should not leave a thumbnail", out.exists())
            } finally {
                srcFile.delete()
                out.delete()
            }
        }
    }

    /** Aspect ratios on either side of 2:3 take different crop branches (crop-sides vs
     * crop-top-bottom) and must both still land at exactly 240x360. 3x2 is also the
     * smallest accepted size (crops to 1x2, cropW = 2 * 2 / 3 = 1) and must still scale up. */
    @Test
    fun writeThumbnail_offAspectRatioCovers_cropToWidgetSize() {
        for ((w, h, hash) in listOf(Triple(3, 2, "boundary3x2"), Triple(300, 900, "tall300x900"))) {
            val srcFile = writeCoverPng(w, h, "widget-cover-$hash.png")
            try {
                BookshelfWidgetStore.writeThumbnail(ctx, hash, srcFile.absolutePath, 42)
                assertWritten(hash, thumbnailFile(hash))
            } finally {
                srcFile.delete()
                thumbnailFile(hash).delete()
            }
        }
    }

    /** A source that can't be decoded - a non-image file, or one that no longer exists -
     * drops the stale thumbnail instead of throwing. */
    @Test
    fun writeThumbnail_badSource_dropsStaleThumbnail() {
        val notAnImage = File(ctx.cacheDir, "widget-cover-not-an-image.png")
        notAnImage.writeText("<html>not an image</html>")
        val missing = File(ctx.cacheDir, "widget-cover-does-not-exist.png")
        for ((label, srcPath) in listOf(
            "undecodable" to notAnImage.absolutePath,
            "missing" to missing.absolutePath,
        )) {
            val hash = "badsource-$label"
            val out = thumbnailFile(hash)
            out.writeBytes(byteArrayOf(1, 2, 3))
            try {
                BookshelfWidgetStore.writeThumbnail(ctx, hash, srcPath, 42)
                assertFalse("$label cover should drop the stale thumbnail", out.exists())
            } finally {
                out.delete()
            }
        }
        notAnImage.delete()
    }

    /** A hash that tries to escape the covers dir is ignored: nothing is written or deleted outside it. */
    @Test
    fun writeThumbnail_hashEscapingCoversDir_isIgnored() {
        val srcFile = writeCoverPng(240, 360, "widget-cover-escape.png")
        val coversDir = BookshelfWidgetStore.coversDir(ctx)
        val outside = File(coversDir.parentFile, "escaped.png")
        outside.writeBytes(byteArrayOf(1, 2, 3))
        try {
            BookshelfWidgetStore.writeThumbnail(ctx, "../escaped", srcFile.absolutePath, 42)
            assertTrue("file outside the covers dir must be left alone", outside.exists())
            assertEquals(3, outside.length())
        } finally {
            srcFile.delete()
            outside.delete()
        }
    }

    /** The progress bar/percent badge is only baked in when showProgress is true (the
     * default): off, two covers differing only in percent are byte-identical; on vs off
     * must differ; omitting the argument must match passing it explicitly. */
    @Test
    fun writeThumbnail_showProgressTogglesTheBakedInPixels() {
        val srcFile = writeCoverPng(240, 360, "widget-cover-progress.png")
        try {
            BookshelfWidgetStore.writeThumbnail(ctx, "low", srcFile.absolutePath, 10, showProgress = false)
            BookshelfWidgetStore.writeThumbnail(ctx, "high", srcFile.absolutePath, 90, showProgress = false)
            BookshelfWidgetStore.writeThumbnail(ctx, "onExplicit", srcFile.absolutePath, 50, showProgress = true)
            BookshelfWidgetStore.writeThumbnail(ctx, "onDefault", srcFile.absolutePath, 50)

            assertTrue(
                "showProgress=false should ignore percent entirely",
                thumbnailFile("low").readBytes().contentEquals(thumbnailFile("high").readBytes()),
            )
            assertFalse(
                "showProgress on vs off must not produce the same bitmap",
                thumbnailFile("onExplicit").readBytes().contentEquals(thumbnailFile("low").readBytes()),
            )
            assertTrue(
                "omitting showProgress should default to true",
                thumbnailFile("onDefault").readBytes().contentEquals(thumbnailFile("onExplicit").readBytes()),
            )
        } finally {
            srcFile.delete()
            listOf("low", "high", "onExplicit", "onDefault").forEach { thumbnailFile(it).delete() }
        }
    }

    /** Whatever the input cover-path list looks like - the normal 4-cover mosaic, fewer
     * (placeholder-filled quadrants), more (extras dropped), some or all undecodable
     * (placeholder-filled), or exactly one (rendered full-size, not a 1-of-4 mosaic) -
     * writeGroupTileThumbnail always succeeds with a correctly-sized composite. */
    @Test
    fun writeGroupTileThumbnail_anyCoverListShape_writesComposite() {
        fun covers(n: Int, w: Int = 240, h: Int = 360) = (1..n).map { writeCoverPng(w, h, "group-$it-$w-$h.png") }
        val missing = File(ctx.cacheDir, "group-missing.png").absolutePath
        val allWritten = mutableListOf<File>()
        try {
            val four = covers(4)
            val two = covers(2, 300, 900)
            val six = covers(6)
            val oneValid = covers(1)
            allWritten += four + two + six + oneValid

            val cases = listOf(
                "four" to four.map { it.absolutePath },
                "fewerThanFour" to two.map { it.absolutePath },
                "moreThanFour" to six.map { it.absolutePath },
                "someUndecodable" to oneValid.map { it.absolutePath } + missing,
                "allUndecodable" to listOf(missing, missing),
                "single" to oneValid.map { it.absolutePath },
            )
            for ((label, paths) in cases) {
                val id = "grouptile-$label"
                BookshelfWidgetStore.writeGroupTileThumbnail(ctx, id, paths)
                assertWritten(label, groupTileFile(id))
                groupTileFile(id).delete()
            }
        } finally {
            allWritten.forEach { it.delete() }
        }
    }

    /** No usable cover at all - an empty list, or a sole undecodable one - drops the
     * stale tile rather than writing an all-placeholder composite. */
    @Test
    fun writeGroupTileThumbnail_noUsableCovers_dropsStaleThumbnail() {
        val missing = File(ctx.cacheDir, "group-cover-single-missing.png").absolutePath
        for ((label, paths) in listOf("empty" to emptyList(), "singleUndecodable" to listOf(missing))) {
            val id = "groupbad-$label"
            val out = groupTileFile(id)
            out.writeBytes(byteArrayOf(1, 2, 3))
            try {
                BookshelfWidgetStore.writeGroupTileThumbnail(ctx, id, paths)
                assertFalse("$label cover list should drop the stale tile", out.exists())
            } finally {
                out.delete()
            }
        }
    }

    /** An id that tries to escape the covers dir is ignored: nothing is written or deleted outside it. */
    @Test
    fun writeGroupTileThumbnail_idEscapingCoversDir_isIgnored() {
        val cover = writeCoverPng(240, 360, "group-cover-escape.png")
        val coversDir = BookshelfWidgetStore.coversDir(ctx)
        val outside = File(coversDir.parentFile, "escaped-group.png")
        outside.writeBytes(byteArrayOf(1, 2, 3))
        try {
            BookshelfWidgetStore.writeGroupTileThumbnail(ctx, "../escaped-group", listOf(cover.absolutePath))
            assertTrue("file outside the covers dir must be left alone", outside.exists())
            assertEquals(3, outside.length())
        } finally {
            cover.delete()
            outside.delete()
        }
    }

    @Test
    fun instanceSettings_roundTripsPerWidgetId() {
        try {
            BookshelfWidgetStore.writeInstanceSettings(
                ctx, 601,
                BookshelfWidgetInstanceSettings(
                    shelfId = "11111111-1111-4111-8111-111111111111",
                    gridRows = 4, gridColumns = 5, showTitles = true, showShelfName = true,
                )
            )
            BookshelfWidgetStore.writeInstanceSettings(
                ctx, 602, BookshelfWidgetInstanceSettings(gridRows = 2)
            )

            val a = BookshelfWidgetStore.readInstanceSettings(ctx, 601)
            assertEquals("11111111-1111-4111-8111-111111111111", a.shelfId)
            assertEquals(4, a.gridRows)
            assertEquals(5, a.gridColumns)
            assertTrue(a.showTitles)
            assertTrue(a.showShelfName)

            assertEquals(2, BookshelfWidgetStore.readInstanceSettings(ctx, 602).gridRows)
        } finally {
            BookshelfWidgetStore.clear(ctx, 601)
            BookshelfWidgetStore.clear(ctx, 602)
        }
    }

    @Test
    fun instanceSettings_fallsBackToDefaultsWhenNeverSetOrMalformed() {
        val neverSet = BookshelfWidgetStore.readInstanceSettings(ctx, 999998)
        assertEquals(BookshelfWidgetInstanceSettings(), neverSet)
        assertEquals(1, neverSet.gridRows)
        assertEquals(3, neverSet.gridColumns)
        assertFalse(neverSet.showTitles)
        assertFalse(neverSet.showShelfName)
        assertEquals("recent", neverSet.shelfId)

        val prefs = ctx.getSharedPreferences(BookshelfWidgetStore.PREFS, Context.MODE_PRIVATE)
        try {
            prefs.edit().putString("instanceSettings_603", "not json").apply()
            assertEquals(
                "malformed JSON",
                BookshelfWidgetInstanceSettings(),
                BookshelfWidgetStore.readInstanceSettings(ctx, 603),
            )
        } finally {
            BookshelfWidgetStore.clear(ctx, 603)
        }
    }

    @Test
    fun snapshot_roundTripsPerWidgetId() {
        try {
            BookshelfWidgetStore.writeSnapshot(ctx, 701, "{\"books\":[{\"hash\":\"a\"}]}")
            BookshelfWidgetStore.writeSnapshot(ctx, 702, "{\"books\":[{\"hash\":\"b\"}]}")
            assertEquals("a", BookshelfWidgetStore.readSnapshot(ctx, 701).getJSONArray("books").getJSONObject(0).getString("hash"))
            assertEquals("b", BookshelfWidgetStore.readSnapshot(ctx, 702).getJSONArray("books").getJSONObject(0).getString("hash"))
        } finally {
            BookshelfWidgetStore.clear(ctx, 701)
            BookshelfWidgetStore.clear(ctx, 702)
        }
    }

    /** A group dropped from a widget's snapshot (a filter or groupBy change) must
     * not leave its cover file behind until the widget itself is deleted. */
    @Test
    fun writeSnapshot_deletesGroupCoversDroppedFromTheNewSnapshot() {
        val id = 751
        val cover = writeCoverPng(240, 360, "widget-cover-snapshot-group.png")
        val keptKey = "$id-kept"
        val droppedKey = "$id-dropped"
        try {
            BookshelfWidgetStore.writeGroupTileThumbnail(ctx, keptKey, listOf(cover.absolutePath))
            BookshelfWidgetStore.writeGroupTileThumbnail(ctx, droppedKey, listOf(cover.absolutePath))
            BookshelfWidgetStore.writeSnapshot(
                ctx, id,
                """{"items":[
                    {"type":"group","id":"g1","coverKey":"$keptKey"},
                    {"type":"group","id":"g2","coverKey":"$droppedKey"}
                ]}""",
            )
            assertTrue("kept cover should exist after the first snapshot", groupTileFile(keptKey).exists())
            assertTrue("dropped cover should exist after the first snapshot", groupTileFile(droppedKey).exists())

            BookshelfWidgetStore.writeSnapshot(
                ctx, id,
                """{"items":[{"type":"group","id":"g1","coverKey":"$keptKey"}]}""",
            )

            assertTrue("cover still referenced by the new snapshot must survive", groupTileFile(keptKey).exists())
            assertFalse("cover dropped from the new snapshot must be deleted", groupTileFile(droppedKey).exists())
        } finally {
            BookshelfWidgetStore.clear(ctx, id)
            cover.delete()
            groupTileFile(keptKey).delete()
            groupTileFile(droppedKey).delete()
        }
    }

    @Test
    fun clear_removesTheSnapshotAndSettingsOfOnlyTheGivenWidgetId() {
        try {
            for ((id, rows) in listOf(651 to 4, 652 to 2)) {
                BookshelfWidgetStore.writeInstanceSettings(ctx, id, BookshelfWidgetInstanceSettings(gridRows = rows))
                BookshelfWidgetStore.writeSnapshot(ctx, id, "{\"books\":[{\"hash\":\"h$id\"}]}")
            }

            BookshelfWidgetStore.clear(ctx, 651)

            assertEquals(BookshelfWidgetInstanceSettings(), BookshelfWidgetStore.readInstanceSettings(ctx, 651))
            assertEquals(0, BookshelfWidgetStore.readSnapshot(ctx, 651).optJSONArray("books")?.length() ?: 0)
            assertEquals(2, BookshelfWidgetStore.readInstanceSettings(ctx, 652).gridRows)
            assertEquals("h652", BookshelfWidgetStore.readSnapshot(ctx, 652).getJSONArray("books").getJSONObject(0).getString("hash"))
        } finally {
            BookshelfWidgetStore.clear(ctx, 651)
            BookshelfWidgetStore.clear(ctx, 652)
        }
    }

    /** A stored coverKey that tries to escape the covers dir is ignored on cleanup,
     * just like the writers: nothing outside the covers dir is deleted. */
    @Test
    fun clear_coverKeyEscapingCoversDir_isIgnored() {
        val id = 761
        val coversDir = BookshelfWidgetStore.coversDir(ctx)
        val outside = File(coversDir.parentFile, "escaped-cleanup.png")
        outside.writeBytes(byteArrayOf(1, 2, 3))
        try {
            BookshelfWidgetStore.writeSnapshot(
                ctx, id,
                """{"items":[{"type":"group","id":"g1","coverKey":"../escaped-cleanup"}]}""",
            )
            BookshelfWidgetStore.clear(ctx, id)
            assertTrue("file outside the covers dir must be left alone", outside.exists())
            assertEquals(3, outside.length())
        } finally {
            outside.delete()
            BookshelfWidgetStore.clear(ctx, id)
        }
    }
}
