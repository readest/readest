package com.readest.native_bridge

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class XiaomiStylusKeysTest {
    @Test
    fun `xiaomi gesture keycodes are recognized`() {
        assertTrue(XiaomiStylusKeys.isStylusKey(XiaomiStylusKeys.SQUEEZE))
        assertTrue(XiaomiStylusKeys.isStylusKey(XiaomiStylusKeys.DOUBLE_TAP))
        assertTrue(XiaomiStylusKeys.isStylusKey(XiaomiStylusKeys.SLIDE_UP))
        assertTrue(XiaomiStylusKeys.isStylusKey(XiaomiStylusKeys.SLIDE_DOWN))
        assertFalse(XiaomiStylusKeys.isStylusKey(KeyEvent.KEYCODE_BUTTON_R1))
    }

    @Test
    fun `xiaomi gesture keycodes map to native key names`() {
        assertEquals("XiaomiSqueeze", XiaomiStylusKeys.nameFor(XiaomiStylusKeys.SQUEEZE))
        assertEquals("XiaomiDoubleTap", XiaomiStylusKeys.nameFor(XiaomiStylusKeys.DOUBLE_TAP))
        assertEquals("XiaomiSlideUp", XiaomiStylusKeys.nameFor(XiaomiStylusKeys.SLIDE_UP))
        assertEquals("XiaomiSlideDown", XiaomiStylusKeys.nameFor(XiaomiStylusKeys.SLIDE_DOWN))
        assertEquals(null, XiaomiStylusKeys.nameFor(KeyEvent.KEYCODE_VOLUME_UP))
    }
}
