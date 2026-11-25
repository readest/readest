package com.bilingify.readest

import android.view.KeyEvent
import org.junit.Assert.assertFalse
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

    // #7875: a pen engine may send gamepad keycodes; learn mode leaves them to the WebView.
    @Test
    fun `gamepad buttons 7 to 10 continue to WebView during learn mode`() {
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_BUTTON_7))
        assertFalse(shouldCaptureNativeLearnKey(KeyEvent.KEYCODE_BUTTON_10))
    }
}
