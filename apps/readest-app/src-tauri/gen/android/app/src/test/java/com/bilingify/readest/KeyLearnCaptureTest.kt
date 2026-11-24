package com.bilingify.readest

import android.view.InputDevice
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyLearnCaptureTest {
    @Test
    fun `keyboard chords continue to WebView during learn mode`() {
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_CTRL_RIGHT))
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_MOVE_END))
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_BUTTON_R1))
    }

    @Test
    fun `media and volume keys still use native learning`() {
        assertTrue(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertTrue(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_VOLUME_UP))
    }

    // #7875: the Xiaomi pen engine reuses gamepad keycodes 194-197.
    @Test
    fun `gamepad buttons 7 to 10 continue to WebView during learn mode`() {
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_BUTTON_7))
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_BUTTON_10))
    }

    @Test
    fun `gamepad buttons 7 9 10 are pen gestures only while the pen engine is registered`() {
        val pen = InputDevice.SOURCE_KEYBOARD
        assertNull(xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_7, pen, penEngineRegistered = false))
        assertEquals("XiaomiSqueeze", xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_7, pen, true))
        assertEquals("XiaomiSlideUp", xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_9, pen, true))
        assertEquals("XiaomiSlideDown", xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_10, pen, true))
        // Double tap is unsupported; other gamepad buttons are never pen gestures.
        assertNull(xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_8, pen, true))
        assertNull(xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_R1, pen, true))
    }

    @Test
    fun `a gamepad or joystick never sends pen gestures`() {
        assertNull(xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_7, InputDevice.SOURCE_GAMEPAD, true))
        assertNull(xiaomiPenKeyName(KeyEvent.KEYCODE_BUTTON_9, InputDevice.SOURCE_JOYSTICK, true))
    }
}
