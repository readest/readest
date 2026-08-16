package com.readest.native_bridge

import android.view.InputDevice
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GamepadDeviceDetectorTest {
    @Test
    fun emptyDeviceList_isDisconnected() {
        assertFalse(hasGamepadDevice(intArrayOf()) { null })
    }

    @Test
    fun unavailableAndNonControllerDevices_areIgnored() {
        val sources = mapOf(
            1 to null,
            2 to InputDevice.SOURCE_KEYBOARD,
            3 to InputDevice.SOURCE_TOUCHSCREEN,
        )

        assertFalse(hasGamepadDevice(intArrayOf(1, 2, 3), sources::get))
    }

    @Test
    fun gamepadSource_isConnected() {
        assertTrue(
            hasGamepadDevice(intArrayOf(7)) {
                InputDevice.SOURCE_GAMEPAD or InputDevice.SOURCE_KEYBOARD
            },
        )
    }

    @Test
    fun joystickSource_isConnected() {
        assertTrue(hasGamepadDevice(intArrayOf(9)) { InputDevice.SOURCE_JOYSTICK })
    }

    @Test
    fun scansPastUnavailableDevices() {
        val sources = mapOf(
            1 to null,
            2 to InputDevice.SOURCE_JOYSTICK,
        )

        assertTrue(hasGamepadDevice(intArrayOf(1, 2), sources::get))
    }
}
