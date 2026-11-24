package com.readest.native_bridge

import android.view.KeyEvent

/**
 * Xiaomi Focus Pen Pro gestures arrive as private keycodes (BUTTON_7..BUTTON_10)
 * once the app registers with the pencil engine.
 */
class XiaomiStylusKeys {
    companion object {
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

    // One key can be dispatched twice (Activity then View) and long-press emits
    // autorepeat DOWNs. Latch each gesture so a single physical action fires once.
    private var pressedMask = 0

    /** Returns the gesture only on its first DOWN; repeated/latched DOWNs are ignored. */
    fun onDown(keyCode: Int, repeatCount: Int): Int? {
        if (!isStylusKey(keyCode)) return null
        val bit = 1 shl keyNames.keys.indexOf(keyCode)
        if (repeatCount != 0 || pressedMask and bit != 0) return null
        pressedMask = pressedMask or bit
        return keyCode
    }

    fun onUp(keyCode: Int) {
        if (!isStylusKey(keyCode)) return
        pressedMask = pressedMask and (1 shl keyNames.keys.indexOf(keyCode)).inv()
    }

    fun reset() {
        pressedMask = 0
    }
}
