package com.readest.native_bridge

import android.view.InputDevice
import android.view.KeyEvent

/**
 * Supports only squeeze, slide up and slide down after pencil-engine registration.
 * Double tap (BUTTON_8) is deliberately unsupported: device recognition is unreliable.
 */
class XiaomiStylusKeys {
    companion object {
        const val SQUEEZE = KeyEvent.KEYCODE_BUTTON_7
        const val SLIDE_UP = KeyEvent.KEYCODE_BUTTON_9
        const val SLIDE_DOWN = KeyEvent.KEYCODE_BUTTON_10

        private val keyNames = mapOf(
            SQUEEZE to "XiaomiSqueeze",
            SLIDE_UP to "XiaomiSlideUp",
            SLIDE_DOWN to "XiaomiSlideDown",
        )

        fun isStylusKey(keyCode: Int): Boolean = keyCode in keyNames

        fun nameFor(keyCode: Int): String? = keyNames[keyCode]

        // These codes overlap generic controller buttons. Never capture those
        // devices, or capture anything before the vendor service is ready.
        fun shouldCapture(keyCode: Int, source: Int, serviceReady: Boolean): Boolean =
            serviceReady && isStylusKey(keyCode) &&
                source and InputDevice.SOURCE_GAMEPAD != InputDevice.SOURCE_GAMEPAD &&
                source and InputDevice.SOURCE_JOYSTICK != InputDevice.SOURCE_JOYSTICK
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
