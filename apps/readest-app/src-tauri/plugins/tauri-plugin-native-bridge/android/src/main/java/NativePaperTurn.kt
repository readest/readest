package com.readest.native_bridge

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.Gravity
import android.view.MotionEvent
import android.view.PixelCopy
import android.webkit.WebView
import android.widget.PopupWindow
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.roundToInt

@InvokeArg
class NativePaperArgs {
    var op = ""
    var owner = 0
    var generation = 0
    var requestId = 0
    var turnId = 0
    var released = false
    var key = ""
    var destination = ""
    var x = 0f; var y = 0f; var width = 0f; var height = 0f
    var forward = true; var rtl = false
    var progress = 0f; var grabY = 0.5f
    var commit = false; var velocity = 0f
    var columns = 1
}

/** CSS px -> WebView px as [left, top, width, height]. The CSS viewport can
 * overhang the WebView (412.19 CSS px x 2.625 = 1082 px on a 1080 px screen).
 * PixelCopy clips that overhang and stretches the rest over the whole bitmap,
 * so the snapshot drew about 2 px larger than the live page. */
internal fun webViewRegion(x: Float, y: Float, width: Float, height: Float, density: Float,
                           viewWidth: Int, viewHeight: Int): IntArray {
    val left = (x * density).roundToInt().coerceIn(0, viewWidth)
    val top = (y * density).roundToInt().coerceIn(0, viewHeight)
    val right = ((x + width) * density).roundToInt().coerceIn(left, viewWidth)
    val bottom = ((y + height) * density).roundToInt().coerceIn(top, viewHeight)
    return intArrayOf(left, top, right - left, bottom - top)
}

/** Lossless native pages -> resident ES2 textures -> native touch/vsync.
 * Only commands, page identities and completion acknowledgements cross IPC. */
internal class NativePaperTurn(private val activity: Activity, private val webView: WebView) {
    private val main = Handler(Looper.getMainLooper())
    private val choreographer = Choreographer.getInstance()
    private var view: NativePaperView? = null
    private var popup: PopupWindow? = null
    @Volatile private var owner = 0
    @Volatile private var generation = 0
    @Volatile private var active = false
    private var dragging = false
    private var turnId = 0
    private var bufferedRelease = false
    private var dirtyAfterFinish = false
    private var current = ""
    private var destination = ""
    private var forward = true
    private var rtl = false
    private var progress = 0f
    private var grabY = 0.5f
    private var width = 1
    private var height = 1
    private var finger = false
    private var trackNativeTouch = false
    private var downX = 0f; private var downY = 0f
    private var lastX = 0f; private var lastY = 0f
    private var drawScheduled = false
    private var cancelled = false
    private var completeRequested = false
    private var animation: Choreographer.FrameCallback? = null
    private var animationPending: Pending? = null
    private var animationTarget = 0f
    private val pending = LinkedHashSet<Pending>()
    private val captures = ConcurrentHashMap<Int, Pending>()
    private val latestCapture = ConcurrentHashMap<String, Int>()
    private val abortedRequests = LinkedHashSet<String>()
    private val requestKeys = LinkedHashMap<Int, String>()
    private val uploadedRequests = LinkedHashSet<Int>()

    private inner class Pending(val complete: (JSObject?, String?) -> Unit) {
        @Volatile var live = true
        private val deadline = Runnable { if (live) failAll("Native page frame timed out") }
        init { pending.add(this); main.postDelayed(deadline, 3000) }
        /** Complete a bridge request once and remove its timeout. */
        fun resolve(result: JSObject = JSObject()) {
            if (!live) return
            live = false; main.removeCallbacks(deadline); pending.remove(this)
            complete(result, null)
        }
        /** Reject a bridge request once and remove its timeout. */
        fun reject(message: String) {
            if (!live) return
            live = false; main.removeCallbacks(deadline); pending.remove(this)
            complete(null, message)
        }
    }

    /** Tear down the failed scene and reject every outstanding request. */
    private fun failAll(message: String) {
        animation?.let { choreographer.removeFrameCallback(it) }; animation = null
        animationPending = null; active = false; dragging = false; cancelled = true
        popup?.dismiss(); popup = null
        view?.onFailure = null; view?.dispose(); view = null
        pending.toList().forEach { it.reject(message) }
        captures.clear(); latestCapture.clear(); requestKeys.clear(); uploadedRequests.clear()
    }

    /** Wait for the live WebView visual state and committed window frame before handoff. */
    private fun presented(p: Pending, action: () -> Unit) {
        if (!webView.isAttachedToWindow || activity.isDestroyed || activity.isFinishing) {
            failAll("WebView not available for native paper"); return
        }
        webView.postVisualStateCallback(0L, object : WebView.VisualStateCallback() {
            override fun onComplete(id: Long) {
                if (!p.live) return
                if (Build.VERSION.SDK_INT >= 29 && webView.isHardwareAccelerated) {
                    webView.viewTreeObserver.registerFrameCommitCallback { main.post { if (p.live) action() } }
                } else webView.postOnAnimation { webView.postOnAnimation { if (p.live) action() } }
                webView.invalidate()
            }
        })
    }

    /** Wait for two UI frames before acknowledging a newly drawn native cover. */
    private fun painted(p: Pending, action: () -> Unit) {
        webView.postOnAnimation { webView.postOnAnimation { if (p.live) action() } }
    }

    /** Convert the command's CSS rect to WebView pixels, clipped to the WebView. */
    private fun region(args: NativePaperArgs) = webViewRegion(args.x, args.y, args.width, args.height,
        webView.resources.displayMetrics.density, webView.width, webView.height)

    /** Create or resize the native cover, refusing a competing owner during an active turn. */
    private fun ensureRegion(args: NativePaperArgs, keep: Pending): Boolean {
        if (owner != args.owner) {
            // A competing idle capture must not tear down the active reader.
            if (active) return false
            pending.toList().filter { it !== keep }.forEach { it.resolve(JSObject().put("ready", false).put("cancelled", true)) }
            captures.clear(); latestCapture.clear(); requestKeys.clear(); uploadedRequests.clear()
            popup?.dismiss(); view?.onFailure = null; view?.dispose(); popup = null; view = null
            owner = args.owner; generation = args.generation
        }
        val (x, y, w, h) = region(args)
        check(w > 0 && h > 0) { "Empty native page region" }
        val screen = IntArray(2); webView.getLocationOnScreen(screen)
        val left = screen[0] + x
        val top = screen[1] + y
        if (view == null) {
            val canvas = NativePaperView(activity).apply {
                alpha = 0.004f
                onFailure = { failAll("Native paper GL: ${it.message}") }
            }
            view = canvas
            popup = PopupWindow(canvas, w, h, false).apply {
                animationStyle = 0; enterTransition = null; exitTransition = null
                isTouchable = false; isClippingEnabled = false
                setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                if (Build.VERSION.SDK_INT >= 29) setIsLaidOutInScreen(true)
                showAtLocation(webView, Gravity.TOP or Gravity.LEFT, left, top)
            }
        } else popup?.update(left, top, w, h)
        width = w; height = h
        return true
    }

    /** Dispatch an owner-scoped bridge command and settle its completion callback. */
    fun command(args: NativePaperArgs, invoke: Invoke) {
        command(args) { result, error -> if (error != null) invoke.reject(error) else invoke.resolve(result ?: JSObject()) }
    }

    /** Dispatch an owner-scoped bridge command and settle its completion callback. */
    internal fun command(args: NativePaperArgs, complete: (JSObject?, String?) -> Unit) {
        val p = Pending(complete)
        try {
            // IPC calls may reach Android out of order, including before this
            // reader has created its first surface. Retain owner-scoped aborts.
            if (args.op == "abortCapture") {
                abortedRequests.add("${args.owner}:${args.requestId}")
                while (abortedRequests.size > 64) abortedRequests.remove(abortedRequests.first())
                if (args.owner != owner) { p.resolve(); return }
            }
            if (args.op == "capture") {
                if (!ensureRegion(args, p)) { p.resolve(JSObject().put("ready", false)); return }
                generation = maxOf(generation, args.generation)
                capture(args, p)
                return
            }
            if (args.owner != owner) { p.resolve(JSObject().put("ready", false)); return }
            if (args.op in arrayOf("move", "animate", "complete", "cancel", "finish") && args.turnId != turnId) {
                p.resolve(JSObject().put("ready", false).put("cancelled", true)); return
            }
            generation = maxOf(generation, args.generation)
            when (args.op) {
                "abortCapture" -> {
                    captures.remove(args.requestId)?.resolve(JSObject().put("ready", false))
                    val key = requestKeys[args.requestId]
                    if (key != null && uploadedRequests.contains(args.requestId)) {
                        view?.drop(key, { latestCapture[key] == args.requestId }) {
                            latestCapture.remove(key, args.requestId)
                            p.resolve()
                        } ?: p.resolve()
                    } else p.resolve()
                }
                "cover" -> {
                    turnId = args.turnId
                    dragging = false
                    current = args.key; destination = current; forward = true; progress = 0f; grabY = 0.5f
                    view!!.scene(current, current, true, false, 0f, 0.5f, 1) { error ->
                        if (!p.live) return@scene
                        if (error != null) failAll(error.message ?: "Native cover failed")
                        else { view?.alpha = 1f; painted(p) { p.resolve() } }
                    }
                }
                "idle" -> {
                    val coveredTurn = turnId
                    // Preview restoration has reached JS, but its WebView
                    // buffer may still contain the previous neighbouring page.
                    presented(p) {
                        if (turnId == coveredTurn) view?.alpha = 0.004f
                        p.resolve()
                    }
                }
                "start" -> {
                    turnId = args.turnId
                    current = args.key; destination = args.destination
                    forward = args.forward; rtl = args.rtl
                    cancelled = false; completeRequested = false
                    progress = args.progress; grabY = args.grabY
                    trackNativeTouch = finger && !args.released
                    bufferedRelease = args.released && progress > 0f
                    if (bufferedRelease) progress = progress.coerceAtMost(0.5f)
                    if (trackNativeTouch) updateFinger()
                    view!!.scene(current, destination, forward, rtl, progress, grabY, args.columns) { error ->
                        if (!p.live) return@scene
                        if (error != null) failAll(error.message ?: "Native pages not ready")
                        else if (cancelled) {
                            // A cancel that overtook scene preparation already hid
                            // the cover; animate and finish settle this scene hidden.
                            active = true; dragging = false
                            p.resolve(JSObject().put("touchTracked", false))
                        } else {
                            active = true; dragging = !bufferedRelease; view?.alpha = 1f
                            if (trackNativeTouch && finger) { updateFinger(); requestDraw() }
                            p.resolve(JSObject().put("touchTracked", trackNativeTouch))
                        }
                    }
                }
                "move" -> {
                    if (active && dragging && !finger && animationPending == null) {
                        progress = args.progress; grabY = args.grabY; requestDraw()
                    }
                    p.resolve()
                }
                "animate" -> animate(args, p)
                "complete" -> { completeRequested = true; p.resolve() }
                "cancel" -> {
                    dragging = false
                    cancelled = true; animationTarget = 0f
                    if (animationPending != null) completeAnimation()
                    else { progress = 0f; view?.alpha = 0f; requestDraw() }
                    p.resolve()
                }
                "finish" -> {
                    presented(p) {
                        if (args.turnId != turnId) {
                            p.resolve(JSObject().put("ready", false).put("cancelled", true)); return@presented
                        }
                        active = false; dragging = false
                        view?.alpha = if (dirtyAfterFinish) 0f else 0.004f
                        if (dirtyAfterFinish) { view?.clear(false); dirtyAfterFinish = false }
                        p.resolve()
                    }
                }
                "invalidate" -> {
                    captures.values.toList().forEach { it.resolve(JSObject().put("ready", false)) }
                    captures.clear(); latestCapture.clear()
                    dirtyAfterFinish = active
                    if (!active) view?.alpha = 0f
                    view?.clear(active)
                    p.resolve()
                }
                "dispose" -> { disposeExcept(p); p.resolve() }
                else -> p.reject("Unknown native paper command")
            }
        } catch (error: Exception) { failAll(error.message ?: "Native paper failed") }
        catch (error: OutOfMemoryError) { failAll("Not enough memory for native paper") }
    }

    /** Capture the Activity pixels beneath the popup and upload a generation-checked page texture. */
    private fun capture(args: NativePaperArgs, p: Pending) {
        if (abortedRequests.remove("${args.owner}:${args.requestId}") || active) { p.resolve(JSObject().put("ready", false)); return }
        captures[args.requestId] = p
        latestCapture[args.key] = args.requestId
        requestKeys[args.requestId] = args.key
        while (requestKeys.size > 32) {
            val oldest = requestKeys.keys.first()
            requestKeys.remove(oldest); uploadedRequests.remove(oldest)
        }
        val valid = { p.live && owner == args.owner && generation == args.generation &&
            latestCapture[args.key] == args.requestId && !active }
        presented(p) {
            if (!valid()) { p.resolve(JSObject().put("ready", false)); return@presented }
            val location = IntArray(2); webView.getLocationInWindow(location)
            val (left, top, w, h) = region(args)
            val x = location[0] + left
            val y = location[1] + top
            val bitmap = try { Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888) }
                catch (error: OutOfMemoryError) { failAll("Not enough memory for native page bitmap"); return@presented }
            try {
                PixelCopy.request(activity.window, Rect(x, y, x + w, y + h), bitmap, { result ->
                    if (!valid() || result != PixelCopy.SUCCESS) {
                        bitmap.recycle(); captures.remove(args.requestId)
                        if (result != PixelCopy.SUCCESS && p.live) failAll("Native page PixelCopy failed: $result")
                        else p.resolve(JSObject().put("ready", false))
                    } else {
                      uploadedRequests.add(args.requestId)
                      view?.upload(args.key, bitmap, valid) { accepted, keys, error ->
                        captures.remove(args.requestId)
                        if (!p.live) return@upload
                        if (error != null) failAll(error.message ?: "Native page upload failed")
                        else p.resolve(JSObject().put("ready", accepted).put("keys", JSArray().apply { keys.forEach { put(it) } }))
                      } ?: run { bitmap.recycle(); p.resolve(JSObject().put("ready", false)) }
                    }
                }, main)
            } catch (error: Exception) { bitmap.recycle(); failAll(error.message ?: "Invalid native capture region") }
        }
    }

    /** Track the native finger without consuming the WebView touch sequence. */
    fun touch(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x; downY = event.y; lastX = event.x; lastY = event.y; finger = true
                if (animationPending != null) completeRequested = true
            }
            MotionEvent.ACTION_MOVE -> {
                lastX = event.x; lastY = event.y
                if (event.pointerCount > 1) { finger = false; return }
                if (active && dragging && trackNativeTouch && animationPending == null) { updateFinger(); requestDraw() }
            }
            MotionEvent.ACTION_UP -> {
                lastX = event.x; lastY = event.y
                if (active && dragging && trackNativeTouch && animationPending == null && finger) { updateFinger(); requestDraw() }
                finger = false; dragging = false
            }
            MotionEvent.ACTION_CANCEL -> { finger = false; dragging = false }
        }
    }
    /** Translate the latest native finger position into the current sheet pose. */
    private fun updateFinger() {
        val distance = if (forward != rtl) downX - lastX else lastX - downX
        progress = (distance / width).coerceIn(0f, 1f)
        grabY = 0.5f + (lastY - downY) / height
    }
    /** Coalesce finger-follow poses into one Choreographer update. */
    private fun requestDraw() {
        if (drawScheduled) return
        drawScheduled = true
        choreographer.postFrameCallback {
            drawScheduled = false
            if (active && animationPending == null) view?.draw(progress, grabY)
        }
    }
    /** Settle the released sheet, advancing only after each native pose is presented. */
    private fun animate(args: NativePaperArgs, p: Pending) {
        if (!active) { p.resolve(JSObject().put("cancelled", true)); return }
        if (animationPending != null) { p.reject("Native paper already settling"); return }
        dragging = false
        animationPending = p
        // Settle from the pose actually selected for rendering. A buffered JS
        // release can be far ahead of that pose and must not erase the leaf
        // before the first animation frame.
        animationTarget = if (args.commit && !cancelled) 1f else 0f
        val from = progress
        val span = abs(animationTarget - from)
        val duration = maxOf(100f, minOf(240f, if (abs(args.velocity) > 0.3f)
            span * width / (abs(args.velocity) * webView.resources.displayMetrics.density) else 240f * span))
        if (span < 0.001f) { completeAnimation(); return }
        var last = 0L
        var elapsed = 0f
        val callback = object : Choreographer.FrameCallback {
            override fun doFrame(now: Long) {
                if (animationPending !== p || !p.live) return
                // Advance only after the preceding image was acquired. A GL
                // stall must not spend the entire animation on unseen frames.
                if (last != 0L) elapsed += ((now - last) / 1_000_000f).coerceIn(0f, 100f / 6f)
                last = now
                // A following gesture accelerates the tail, but cannot erase
                // a scene before its first curved frame. Keep the 100ms
                // minimum even when completion arrived before animate.
                val settleDuration = if (completeRequested) minOf(duration, 100f) else duration
                val t = (elapsed / settleDuration).coerceAtMost(1f)
                progress = from + (animationTarget - from) * t
                if (t < 1f) view?.drawPresented(progress, grabY) { error ->
                    if (animationPending !== p || !p.live) return@drawPresented
                    if (error != null) failAll(error.message ?: "Native animation frame failed")
                    // Acquisition already paces us to a displayed frame.
                    // Submit the next pose now, avoiding an extra idle vsync.
                    else doFrame(System.nanoTime())
                }
                else completeAnimation()
            }
        }
        animation = callback; choreographer.postFrameCallback(callback)
    }
    /** Present the terminal pose before acknowledging settlement. */
    private fun completeAnimation() {
        val p = animationPending ?: return
        animation?.let { choreographer.removeFrameCallback(it) }; animation = null
        progress = animationTarget
        view?.discardPresentation()
        view?.drawPresented(progress, grabY) { error ->
            if (error != null) failAll(error.message ?: "Native final frame failed")
            else painted(p) {
                if (animationPending === p) animationPending = null
                p.resolve(JSObject().put("cancelled", cancelled))
            }
        }
    }
    /** Release the scene and settle outstanding requests except the caller being disposed. */
    private fun disposeExcept(keep: Pending?) {
        animation?.let { choreographer.removeFrameCallback(it) }; animation = null
        animationPending = null; active = false; dragging = false
        pending.toList().filter { it !== keep }.forEach { it.resolve(JSObject().put("ready", false).put("cancelled", true)) }
        captures.clear()
        popup?.dismiss(); popup = null; view?.onFailure = null; view?.dispose(); view = null
        latestCapture.clear(); requestKeys.clear(); uploadedRequests.clear(); owner = 0
    }
    /** Release the scene and all outstanding native commands. */
    fun dispose() = disposeExcept(null)
}
