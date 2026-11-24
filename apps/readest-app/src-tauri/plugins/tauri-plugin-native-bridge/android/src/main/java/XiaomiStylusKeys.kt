package com.readest.native_bridge

import android.view.KeyEvent

/**
 * Xiaomi Focus Pen Pro gestures arrive as private keycodes (BUTTON_7..BUTTON_10)
 * once the app registers with the pencil engine. Keep the mapping in one place
 * so learn mode, interception and forwarding agree on the native key names.
 */
object XiaomiStylusKeys {
    const val SQUEEZE = KeyEvent.KEYCODE_BUTTON_7
    const val DOUBLE_TAP = KeyEvent.KEYCODE_BUTTON_8
    const val SLIDE_UP = KeyEvent.KEYCODE_BUTTON_9
    const val SLIDE_DOWN = KeyEvent.KEYCODE_BUTTON_10

    private val keyNames = mapOf(
        SQUEEZE to "XiaomiSqueeze",
        DOUBLE_TAP to "XiaomiDoubleTap",
        SLIDE_UP to "XiaomiSlideUp",
        SLIDE_DOWN to "XiaomiSlideDown",
    )

    fun isStylusKey(keyCode: Int): Boolean = keyCode in keyNames

    fun nameFor(keyCode: Int): String? = keyNames[keyCode]
}
