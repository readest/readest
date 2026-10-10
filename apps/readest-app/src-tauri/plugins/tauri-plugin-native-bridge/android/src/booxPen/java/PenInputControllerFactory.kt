package com.readest.native_bridge

import android.graphics.Rect
import android.os.Build
import android.util.Log
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import com.onyx.android.sdk.api.device.epd.EpdController
import com.onyx.android.sdk.data.note.TouchPoint
import com.onyx.android.sdk.pen.RawInputCallback
import com.onyx.android.sdk.pen.TouchHelper
import com.onyx.android.sdk.pen.data.TouchPointList

/**
 * `booxPen` flavor: drives BOOX low-latency raw drawing through the Onyx Pen
 * SDK. This file and its Gradle dependency are the whole BOOX-specific surface.
 */
object PenInputControllerFactory {
    fun create(): PenInputController = BooxPenInputController()
}

private class BooxPenInputController : PenInputController {
    private var helper: TouchHelper? = null

    override fun isBooxDevice(): Boolean {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        return manufacturer.contains("onyx") || brand.contains("onyx") || brand.contains("boox")
    }

    /**
     * Raw drawing reads an EMR pen layer. Pen-less BOOX readers (the Leaf line)
     * still advertise STYLUS on their capacitive panel, which reports a contact
     * size; a pen digitizer doesn't. Without one, drawing stays on pointer events
     * so a finger still works.
     */
    private fun hasPenDigitizer(): Boolean =
        InputDevice.getDeviceIds().any { id ->
            val device = InputDevice.getDevice(id) ?: return@any false
            device.supportsSource(InputDevice.SOURCE_STYLUS) &&
                device.getMotionRange(MotionEvent.AXIS_TOUCH_MAJOR) == null
        }

    override fun canRawDraw(): Boolean {
        if (!isBooxDevice() || !hasPenDigitizer()) return false
        return try {
            // Touching EpdController proves the SDK's native layer is present on
            // this firmware, not just linked at compile time.
            EpdController.getMaxTouchPressure()
            true
        } catch (e: Throwable) {
            Log.w(TAG, "BOOX pen SDK unavailable: ${e.message}")
            false
        }
    }

    override fun start(
        view: View,
        region: PenRegion,
        strokeWidthPx: Float,
        strokeColor: Int,
        onBatch: (List<PenPoint>, PenEventKind) -> Unit,
    ) {
        stop()
        if (!canRawDraw()) return
        val maxPressure = EpdController.getMaxTouchPressure().takeIf { it > 0f } ?: 1f
        fun TouchPointList.toPenPoints() =
            points.map { PenPoint(it.x, it.y, (it.pressure / maxPressure).coerceIn(0f, 1f), it.timestamp) }

        // The SDK paints the stroke itself while the pen moves and hands over
        // the whole stroke on pen-up, so each stroke reaches JS as one batch.
        val callback = object : RawInputCallback() {
            override fun onBeginRawDrawing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onEndRawDrawing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onRawDrawingTouchPointMoveReceived(touchPoint: TouchPoint) {}
            override fun onRawDrawingTouchPointListReceived(touchPointList: TouchPointList) {
                onBatch(touchPointList.toPenPoints(), PenEventKind.DRAW_END)
            }
            override fun onBeginRawErasing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onEndRawErasing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onRawErasingTouchPointMoveReceived(touchPoint: TouchPoint) {}
            override fun onRawErasingTouchPointListReceived(touchPointList: TouchPointList) {
                onBatch(touchPointList.toPenPoints(), PenEventKind.ERASE_END)
            }
        }
        val limit = Rect(
            region.left.toInt(),
            region.top.toInt(),
            (region.left + region.width).toInt(),
            (region.top + region.height).toInt(),
        )
        try {
            helper = TouchHelper.create(view, callback)
                .setStrokeWidth(strokeWidthPx)
                .setStrokeColor(strokeColor)
                .setLimitRect(limit, emptyList())
                .openRawDrawing()
            helper?.setRawDrawingEnabled(true)
        } catch (e: Throwable) {
            Log.e(TAG, "failed to start BOOX raw drawing", e)
            helper = null
        }
    }

    override fun stop() {
        try {
            helper?.closeRawDrawing()
        } catch (e: Throwable) {
            Log.w(TAG, "closeRawDrawing failed: ${e.message}")
        } finally {
            helper = null
        }
    }

    companion object {
        private const val TAG = "BooxPenController"
    }
}
