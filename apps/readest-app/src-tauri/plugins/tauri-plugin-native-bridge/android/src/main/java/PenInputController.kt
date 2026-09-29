package com.readest.native_bridge

/**
 * Handwriting: the one seam between Readest's native bridge and any
 * vendor stylus SDK. `NativeBridgePlugin` talks only to this interface, so
 * BOOX-specific types (TouchHelper, RawInputCallback, TouchPoint, ...) never
 * appear outside the `booxPen` build-flavor source set that implements it.
 *
 * [PenInputControllerFactory.create] resolves to one of two implementations
 * at compile time via Android's flavor source-set override, both under this
 * same package/object name:
 *  - `android/src/genericPen/...` — always compiled into FOSS/default builds;
 *    reports [isBoox]=false / raw drawing unavailable, no SDK dependency.
 *  - `android/src/booxPen/...` — pulls in `com.onyx.android.sdk:onyxsdk-pen`
 *    and drives the real BOOX `TouchHelper`. Only present in builds that
 *    opt in via the `pen=boox` Gradle flavor (see android/README-pen.md).
 */
interface PenInputController {
    /** True on a BOOX-manufactured device, independent of SDK availability. */
    fun isBooxDevice(): Boolean

    /** True only when this build can actually drive raw drawing right now. */
    fun canRawDraw(): Boolean

    /**
     * Starts raw-drawing mode over [region] (CSS px of the webview
     * viewport, already scaled to window pixels by the caller). Points are
     * delivered to [onBatch] in small batches, never one IPC call per point.
     * No-ops (does not throw) when [canRawDraw] is false.
     */
    fun start(region: PenRegion, strokeWidthPx: Float, onBatch: (List<PenPoint>, PenEventKind) -> Unit)

    fun setEnabled(enabled: Boolean)

    fun stop()
}

data class PenRegion(val left: Float, val top: Float, val width: Float, val height: Float)

/** One raw stylus sample; `pressure` is 0f when the device reports none. */
data class PenPoint(val x: Float, val y: Float, val pressure: Float, val timestamp: Long)

enum class PenEventKind { DRAW_MOVE, DRAW_END, ERASE_MOVE, ERASE_END }

/** Always-compiled default: no BOOX hardware assumed, nothing to isolate. */
object NoOpPenInputController : PenInputController {
    override fun isBooxDevice() = false
    override fun canRawDraw() = false
    override fun start(region: PenRegion, strokeWidthPx: Float, onBatch: (List<PenPoint>, PenEventKind) -> Unit) {}
    override fun setEnabled(enabled: Boolean) {}
    override fun stop() {}
}
