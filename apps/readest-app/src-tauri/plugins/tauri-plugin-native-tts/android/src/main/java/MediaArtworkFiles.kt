package com.readest.native_tts

import java.io.File

// Separate from the Android service so URI uniqueness across service lifetimes
// can be tested on the JVM without constructing a MediaBrowserService.
internal class MediaArtworkFiles {
    fun create(cacheDir: File): File = File.createTempFile("tts_cover_", ".png", cacheDir)

    fun pruneAbandoned(cacheDir: File) {
        cacheDir.listFiles()?.forEach { file ->
            if (file.isFile && COVER_FILENAME.matches(file.name)) file.delete()
        }
    }

    private companion object {
        val COVER_FILENAME = Regex("tts_cover_[0-9]+\\.png")
    }
}
