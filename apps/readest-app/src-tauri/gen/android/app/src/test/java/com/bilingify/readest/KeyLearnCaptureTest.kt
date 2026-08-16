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
}
