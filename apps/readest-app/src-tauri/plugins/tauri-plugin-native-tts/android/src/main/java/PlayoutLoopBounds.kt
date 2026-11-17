package com.readest.native_tts

// Where the native A-B repeat jumps back to A. Separate from the plugin so the
// clamping can be tested on the JVM without an ExoPlayer.
internal object PlayoutLoopBounds {
    // How close to a file's end the loop end is pulled in, so the jump is made
    // before the file plays out.
    const val END_SLACK_MS = 40L

    // B's end, pulled in to just before the end of a file of `durationMs`
    // (non-positive while unknown). Never pulled to or before A: a span inside
    // the file's last moments would then jump back on every check without
    // playing. Such a span ends with the file, where the player's end-of-file
    // and roll-over handling loops it back instead.
    fun effectiveEnd(startMs: Long, endMs: Long, durationMs: Long): Long {
        if (durationMs <= 0) return endMs
        val clamped = minOf(endMs, durationMs - END_SLACK_MS)
        return if (clamped > startMs) clamped else endMs
    }
}
