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

    @Test
    fun `a gesture fires only once until it is released`() {
        val keys = XiaomiStylusKeys()
        // First DOWN of each gesture is delivered.
        assertEquals(
            XiaomiStylusKeys.SQUEEZE,
            keys.onDown(XiaomiStylusKeys.SQUEEZE, 0),
        )
        // A repeated DOWN (long-press autorepeat) while still held is ignored.
        assertEquals(null, keys.onDown(XiaomiStylusKeys.SQUEEZE, 1))
        assertEquals(null, keys.onDown(XiaomiStylusKeys.SQUEEZE, 0))
        // UP clears the latch; the next DOWN is delivered again.
        keys.onUp(XiaomiStylusKeys.SQUEEZE)
        assertEquals(
            XiaomiStylusKeys.SQUEEZE,
            keys.onDown(XiaomiStylusKeys.SQUEEZE, 0),
        )
    }

    @Test
    fun `gestures are latched independently`() {
        val keys = XiaomiStylusKeys()
        assertEquals(
            XiaomiStylusKeys.DOUBLE_TAP,
            keys.onDown(XiaomiStylusKeys.DOUBLE_TAP, 0),
        )
        assertEquals(
            XiaomiStylusKeys.SLIDE_UP,
            keys.onDown(XiaomiStylusKeys.SLIDE_UP, 0),
        )
        assertEquals(null, keys.onDown(XiaomiStylusKeys.DOUBLE_TAP, 0))
        keys.reset()
        assertEquals(
            XiaomiStylusKeys.DOUBLE_TAP,
            keys.onDown(XiaomiStylusKeys.DOUBLE_TAP, 0),
        )
    }
}
