package com.bilingify.readest

import android.view.KeyEvent
import com.readest.native_bridge.XiaomiStylusKeys
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

    @Test
    fun `xiaomi stylus gestures use native learning`() {
        assertTrue(shouldCaptureNativeLearnKey(XiaomiStylusKeys.SQUEEZE))
        assertTrue(shouldCaptureNativeLearnKey(XiaomiStylusKeys.DOUBLE_TAP))
        assertTrue(shouldCaptureNativeLearnKey(XiaomiStylusKeys.SLIDE_UP))
        assertTrue(shouldCaptureNativeLearnKey(XiaomiStylusKeys.SLIDE_DOWN))
    }
}
