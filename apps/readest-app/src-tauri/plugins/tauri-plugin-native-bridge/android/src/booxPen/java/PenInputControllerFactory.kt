package com.readest.native_bridge

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.util.Log
import com.onyx.android.sdk.api.device.epd.EpdController
import com.onyx.android.sdk.pen.RawInputCallback
import com.onyx.android.sdk.pen.TouchHelper
import com.onyx.android.sdk.pen.data.TouchPoint
import com.onyx.android.sdk.pen.data.TouchPointList

/**
 * `booxPen` flavor build: links `com.onyx.android.sdk:onyxsdk-pen` and talks
 * to the real BOOX TouchHelper. This file — and its Gradle dependency — is
 * the entire BOOX-specific surface; nothing outside it (including
 * [NativeBridgePlugin]) references an Onyx SDK type.
 *
 * NOTE: written against the documented TouchHelper/RawInputCallback API
 * (onyx-intl/OnyxAndroidDemo, doc/Onyx-Pen-SDK.md) but has not been compiled
 * or run — this environment has neither the Onyx Maven repository nor
 * physical BOOX hardware. See android/README-pen.md for what still needs
 * verification on a device.
 */
object PenInputControllerFactory {
    fun create(activity: Activity): PenInputController = BooxPenInputController(activity)
}

private class BooxPenInputController(private val activity: Activity) : PenInputController {
    private var helper: TouchHelper? = null

    override fun isBooxDevice(): Boolean {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        return manufacturer.contains("onyx") || brand.contains("onyx") || brand.contains("boox")
    }

    override fun canRawDraw(): Boolean {
        if (!isBooxDevice()) return false
        return try {
            // Touching EpdController is the cheapest available proof that the
            // SDK's native layer is actually present on this firmware, not
            // just linked at compile time.
            EpdController.getMaxTouchPressure() > 0
            true
        } catch (e: Throwable) {
            Log.w(TAG, "BOOX pen SDK unavailable: ${e.message}")
            false
        }
    }

    override fun start(region: PenRegion, strokeWidthPx: Float, onBatch: (List<PenPoint>, PenEventKind) -> Unit) {
        if (!canRawDraw()) return
        val view = activity.window?.decorView ?: return
        val limit = Rect(
            region.left.toInt(),
            region.top.toInt(),
            (region.left + region.width).toInt(),
            (region.top + region.height).toInt(),
        )
        val callback = object : RawInputCallback() {
            override fun onBeginRawDrawing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onEndRawDrawing(b: Boolean, touchPoint: TouchPoint) {
                onBatch(listOf(touchPoint.toPenPoint()), PenEventKind.DRAW_END)
            }
            override fun onRawDrawingTouchPointMoveReceived(touchPoint: TouchPoint) {}
            override fun onRawDrawingTouchPointListReceived(touchPointList: TouchPointList) {
                onBatch(touchPointList.points.map { it.toPenPoint() }, PenEventKind.DRAW_MOVE)
            }
            override fun onBeginRawErasing(b: Boolean, touchPoint: TouchPoint) {}
            override fun onEndRawErasing(b: Boolean, touchPoint: TouchPoint) {
                onBatch(listOf(touchPoint.toPenPoint()), PenEventKind.ERASE_END)
            }
            override fun onRawErasingTouchPointMoveReceived(touchPoint: TouchPoint) {}
            override fun onRawErasingTouchPointListReceived(touchPointList: TouchPointList) {
                onBatch(touchPointList.points.map { it.toPenPoint() }, PenEventKind.ERASE_MOVE)
            }
        }
        try {
            helper = TouchHelper.create(view, callback)
                .setStrokeWidth(strokeWidthPx)
                .setLimitRect(limit, emptyList())
            helper?.openRawDrawing()
            helper?.setRawDrawingEnabled(true)
        } catch (e: Throwable) {
            Log.e(TAG, "failed to start BOOX raw drawing", e)
            helper = null
        }
    }

    override fun setEnabled(enabled: Boolean) {
        try {
            helper?.setRawDrawingEnabled(enabled)
        } catch (e: Throwable) {
            Log.w(TAG, "setRawDrawingEnabled failed: ${e.message}")
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

    private fun TouchPoint.toPenPoint() = PenPoint(x, y, pressure, timestamp)

    companion object {
        private const val TAG = "BooxPenController"
    }
}
