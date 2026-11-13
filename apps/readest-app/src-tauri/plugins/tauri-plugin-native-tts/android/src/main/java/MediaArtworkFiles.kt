package com.readest.native_tts

import java.io.File

// Separate from the Android service so URI uniqueness across service lifetimes
// can be tested on the JVM without constructing a MediaBrowserService.
internal class MediaArtworkFiles {
    fun create(cacheDir: File): File = File.createTempFile("tts_cover_", ".png", cacheDir)
}
