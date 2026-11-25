package com.readest.native_bridge

/**
 * A system pen service that sends stylus gestures, as key events, only to the
 * app registered with it (#7875). MainActivity registers its engines on resume
 * and unregisters them on pause, so the system keeps the gestures while Readest
 * is in the background. On a device without the service an engine does nothing.
 */
interface PenEngine {
    fun register()

    fun unregister()

    /** The gesture name JS binds (one of the constants below), or null for any other key. */
    fun gestureKeyName(keyCode: Int, source: Int): String?

    companion object {
        // Shared by every engine; keybinding.ts labels them.
        const val SQUEEZE = "PenSqueeze"
        const val SLIDE_UP = "PenSlideUp"
        const val SLIDE_DOWN = "PenSlideDown"
    }
}
