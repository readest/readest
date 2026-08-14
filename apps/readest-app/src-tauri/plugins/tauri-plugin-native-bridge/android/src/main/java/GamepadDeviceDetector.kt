package com.readest.native_bridge

import android.view.InputDevice

internal fun hasGamepadDevice(
    deviceIds: IntArray,
    sourcesForDevice: (Int) -> Int?,
): Boolean = deviceIds.any { deviceId ->
    val sources = sourcesForDevice(deviceId) ?: return@any false
    sources and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
        sources and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK
}
