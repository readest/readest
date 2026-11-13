package com.readest.native_tts

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
