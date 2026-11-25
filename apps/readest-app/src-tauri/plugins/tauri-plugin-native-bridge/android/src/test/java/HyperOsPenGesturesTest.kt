package com.readest.native_bridge

import android.view.InputDevice
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HyperOsPenGesturesTest {
    private val pen = InputDevice.SOURCE_KEYBOARD

    @Test
    fun `buttons 7 9 10 are pen gestures`() {
        assertEquals(PenEngine.SQUEEZE, HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_7, pen))
        assertEquals(PenEngine.SLIDE_UP, HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_9, pen))
        assertEquals(PenEngine.SLIDE_DOWN, HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_10, pen))
    }

    @Test
    fun `double tap and other keys are not pen gestures`() {
        assertNull(HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_8, pen))
        assertNull(HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_R1, pen))
        assertNull(HyperOsPenEngine.keyName(KeyEvent.KEYCODE_PAGE_DOWN, pen))
    }

    @Test
    fun `a gamepad or joystick never sends pen gestures`() {
        assertNull(HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_7, InputDevice.SOURCE_GAMEPAD))
        assertNull(HyperOsPenEngine.keyName(KeyEvent.KEYCODE_BUTTON_9, InputDevice.SOURCE_JOYSTICK))
    }
}
