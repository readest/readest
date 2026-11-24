package com.readest.native_tts

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class MediaArtworkFilesTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun startupPrunesOnlyAbandonedPlaybackArtwork() {
        val cacheDir = temporaryFolder.newFolder("cache")
        val abandoned = MediaArtworkFiles().create(cacheDir)
        val legacyCover = File(cacheDir, "tts_cover_1.png").apply { writeText("old cover") }
        val unrelated = File(cacheDir, "tts_cover_notes.png").apply { writeText("other cache") }
        val thumbnailDir = File(cacheDir, "cover-thumbnails").apply { mkdir() }
        val thumbnail = File(thumbnailDir, "book.jpg").apply { writeText("library cover") }

        val artworkFiles = MediaArtworkFiles()
        artworkFiles.pruneAbandoned(cacheDir)
        val currentCover = artworkFiles.create(cacheDir)

        assertEquals(setOf(unrelated, thumbnailDir, currentCover), cacheDir.listFiles()!!.toSet())
        assertEquals("library cover", thumbnail.readText())
        assertNotEquals(abandoned.toURI(), currentCover.toURI())
        assertNotEquals(legacyCover.toURI(), currentCover.toURI())
    }

    @Test
    fun recreatedServiceDoesNotOverwritePreviousCover() {
        val cacheDir = temporaryFolder.newFolder("cache")
        val firstCover = MediaArtworkFiles().create(cacheDir)
        firstCover.writeText("first book")

        // A new service gets a new allocator but shares the same cache directory.
        val secondCover = MediaArtworkFiles().create(cacheDir)
        secondCover.writeText("second book")

        assertNotEquals(firstCover.toURI(), secondCover.toURI())
        assertEquals("first book", firstCover.readText())
        assertEquals("second book", secondCover.readText())
    }

    @Test
    fun recreatedServiceDoesNotReuseDeletedCoverUri() {
        val cacheDir = temporaryFolder.newFolder("cache")
        val firstCover = MediaArtworkFiles().create(cacheDir)
        val cachedUri = firstCover.toURI()
        assertTrue(firstCover.delete())

        // Android Auto may retain the URI even after service teardown removes the file.
        val nextCover = MediaArtworkFiles().create(cacheDir)

        assertTrue(nextCover.isFile)
        assertEquals(cacheDir, nextCover.parentFile)
        assertNotEquals(cachedUri, nextCover.toURI())
    }
}
