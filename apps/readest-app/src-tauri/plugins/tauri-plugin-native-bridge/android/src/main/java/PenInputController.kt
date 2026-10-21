package com.readest.native_bridge

import android.view.View

/**
 * The seam between the native bridge and a vendor stylus SDK. Only the
 * `booxPen` flavor (android/src/booxPen) implements it with the BOOX Pen SDK;
 * every other build gets [NoOpPenInputController] from
 * android/src/genericPen and draws through browser pointer events instead.
 */
interface PenInputController {
    fun isBooxDevice(): Boolean

    /** True only when this build can drive raw drawing on this device. */
    fun canRawDraw(): Boolean

    /**
     * (Re)starts raw drawing on [view] over [region], in [view] pixels.
     * Points are reported in [view] pixels, a batch per SDK callback.
     */
    fun start(
        view: View,
        region: PenRegion,
        strokeWidthPx: Float,
        strokeColor: Int,
        onBatch: (List<PenPoint>, PenEventKind) -> Unit,
    )

    fun stop()
}

data class PenRegion(val left: Float, val top: Float, val width: Float, val height: Float)

/** One raw stylus sample; `pressure` is 0f when the device reports none. */
data class PenPoint(val x: Float, val y: Float, val pressure: Float, val timestamp: Long)

enum class PenEventKind { DRAW_MOVE, DRAW_END, ERASE_MOVE, ERASE_END }

object NoOpPenInputController : PenInputController {
    override fun isBooxDevice() = false
    override fun canRawDraw() = false
    override fun start(
        view: View,
        region: PenRegion,
        strokeWidthPx: Float,
        strokeColor: Int,
        onBatch: (List<PenPoint>, PenEventKind) -> Unit,
    ) {}
    override fun stop() {}
}
