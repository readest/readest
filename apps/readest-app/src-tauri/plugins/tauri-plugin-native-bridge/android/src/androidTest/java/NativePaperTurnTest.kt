package com.readest.native_bridge

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.Gravity
import android.widget.PopupWindow
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.tauri.plugin.JSObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class NativePaperTurnTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val w = 360
    private val h = 640

    private inner class Harness : AutoCloseable {
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext,
            ClipUrlTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        lateinit var web: WebView
        lateinit var paper: NativePaperTurn
        var holdPresentation = false
        val heldPresentations = ArrayList<() -> Unit>()
        var request = 0
        init {
            val loaded = CountDownLatch(1)
            instrumentation.runOnMainSync {
                web = object : WebView(activity) {
                    override fun postVisualStateCallback(requestId: Long, callback: VisualStateCallback) {
                        if (holdPresentation) heldPresentations.add {
                            super.postVisualStateCallback(requestId, callback)
                        } else super.postVisualStateCallback(requestId, callback)
                    }
                }
                web.settings.javaScriptEnabled = true
                web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) { loaded.countDown() }
                }
                val root = FrameLayout(activity)
                root.addView(web, FrameLayout.LayoutParams(w, h)); activity.setContentView(root)
                paper = NativePaperTurn(activity, web)
                web.setOnTouchListener { _, event -> paper.touch(event); false }
                web.loadDataWithBaseURL("https://readest-native.invalid/", """
                    <meta name="viewport" content="width=device-width,initial-scale=1">
                    <style>html,body{margin:0;height:100%;background:rgb(255,0,0)}</style>
                    <body></body>
                """, "text/html", "UTF-8", null)
            }
            assertTrue("WebView fixture loaded", loaded.await(10, TimeUnit.SECONDS))
        }
        fun args(op: String, configure: NativePaperArgs.() -> Unit = {}) = NativePaperArgs().apply {
            this.op = op; owner = 1; generation = 0
            val density = activity.resources.displayMetrics.density
            width = w / density; height = h / density
            configure()
        }
        fun command(op: String, configure: NativePaperArgs.() -> Unit = {}): JSObject {
            val done = CountDownLatch(1)
            val result = AtomicReference<JSObject>()
            val error = AtomicReference<String>()
            instrumentation.runOnMainSync {
                paper.command(args(op, configure)) { value, message ->
                    result.set(value); error.set(message); done.countDown()
                }
            }
            assertTrue("Native $op completed", done.await(6, TimeUnit.SECONDS))
            assertNull("Native $op: ${error.get()}", error.get())
            return result.get()
        }
        fun capture(key: String): JSObject = command("capture") { this.key = key; requestId = ++request }
        fun color(color: String) {
            val done = CountDownLatch(1)
            instrumentation.runOnMainSync {
                web.evaluateJavascript("document.documentElement.style.background='$color';document.body.style.background='$color'") { done.countDown() }
            }
            assertTrue(done.await(3, TimeUnit.SECONDS))
        }
        fun nativeView(): NativePaperView {
            val field = NativePaperTurn::class.java.getDeclaredField("view").apply { isAccessible = true }
            return field.get(paper) as NativePaperView
        }
        fun nativePixel(x: Int = w / 2, y: Int = h / 2): Int {
            var pixel = 0
            instrumentation.runOnMainSync {
                val image = nativeView().bitmap
                assertNotNull("Native texture frame available", image)
                pixel = image!!.getPixel(x, y); image.recycle()
            }
            return pixel
        }
        fun awaitNativeColor(expected: Int, x: Int = w / 2, y: Int = h / 2) {
            val deadline = SystemClock.uptimeMillis() + 2000
            var pixel = 0
            while (SystemClock.uptimeMillis() < deadline) {
                pixel = nativePixel(x, y)
                if (absColor(pixel, expected) <= 3) return
                Thread.sleep(16)
            }
            assertEquals("Native frame at $x,$y", expected, pixel)
        }
        fun activityPixel(): Int {
            val done = CountDownLatch(1)
            val image = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            var status = -1
            instrumentation.runOnMainSync {
                val position = IntArray(2); web.getLocationInWindow(position)
                PixelCopy.request(activity.window, Rect(position[0], position[1], position[0] + w, position[1] + h),
                    image, { status = it; done.countDown() }, Handler(Looper.getMainLooper()))
            }
            assertTrue(done.await(3, TimeUnit.SECONDS)); assertEquals(PixelCopy.SUCCESS, status)
            val pixel = image.getPixel(w / 2, h / 2); image.recycle(); return pixel
        }
        fun touch(action: Int, x: Float) {
            instrumentation.runOnMainSync {
                val now = SystemClock.uptimeMillis()
                val event = MotionEvent.obtain(now, now, action, x, h / 2f, 0)
                web.dispatchTouchEvent(event); event.recycle()
            }
        }
        override fun close() {
            instrumentation.runOnMainSync { paper.dispose(); web.destroy(); activity.finish() }
        }
    }

    private fun absColor(a: Int, b: Int) = maxOf(kotlin.math.abs(Color.red(a) - Color.red(b)),
        kotlin.math.abs(Color.green(a) - Color.green(b)), kotlin.math.abs(Color.blue(a) - Color.blue(b)))

    @Test fun spreadTurnsItsOuterColumnOntoTheFacingPage() {
        Harness().use { f ->
            f.color("linear-gradient(90deg,rgb(255,0,0) 50%,rgb(0,255,0) 50%)"); f.capture("current")
            f.command("cover") { key = "current" }
            f.color("linear-gradient(90deg,rgb(0,0,255) 50%,rgb(255,255,0) 50%)"); f.capture("next")
            f.command("start") { key = "current"; destination = "next"; progress = 0.6f; columns = 2 }
            // Mid-turn, the inner column is still the current spread's page.
            f.awaitNativeColor(Color.RED, 4, h / 2)
            f.command("animate") { commit = true }
            // The landed leaf shows the next spread's facing page on its back.
            f.awaitNativeColor(Color.BLUE, w / 8, h / 2)
            f.awaitNativeColor(Color.YELLOW, w * 7 / 8, h / 2)
            f.command("finish")
        }
    }

    @Test fun cancellingBeforeSettlementHidesTheNativeSheetAndAllowsTheNextTurn() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green")
            f.command("start") { key = "red"; destination = "green"; progress = 0.3f }
            instrumentation.runOnMainSync { assertEquals(1f, f.nativeView().alpha, 0f) }
            f.command("cancel")
            instrumentation.runOnMainSync {
                assertEquals("A cancelled drag must not leave a stale native cover", 0f, f.nativeView().alpha, 0f)
            }
            f.command("finish")
            f.command("start") { key = "green"; destination = "red"; forward = false; turnId = 1 }
            f.command("animate") { commit = true; turnId = 1 }
            f.awaitNativeColor(Color.RED)
            f.color("red"); f.command("finish") { turnId = 1 }
        }
    }

    @Test fun aCancelBeforeTheSceneIsReadyKeepsTheCoverHidden() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green")
            // The scene is prepared on the GL thread, so the cancel reaches
            // the main thread before the start callback does.
            val started = CountDownLatch(1)
            var alpha = -1f
            instrumentation.runOnMainSync {
                f.paper.command(f.args("start") { key = "red"; destination = "green"; progress = 0.3f }) { _, _ ->
                    alpha = f.nativeView().alpha; started.countDown()
                }
                f.paper.command(f.args("cancel")) { _, _ -> }
            }
            assertTrue(started.await(6, TimeUnit.SECONDS))
            assertEquals("A cancelled scene must not restore its cover", 0f, alpha, 0f)
            f.command("finish")
            instrumentation.runOnMainSync { assertNotEquals(1f, f.nativeView().alpha) }
        }
    }

    @Test fun anotherReadersCaptureDoesNotDestroyTheActiveOwnersPendingFinish() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green")
            f.command("start") { key = "red"; destination = "green" }
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.GREEN)
            val canvas = f.nativeView()
            val finished = CountDownLatch(1)
            val finishError = AtomicReference<String>()
            instrumentation.runOnMainSync {
                f.holdPresentation = true
                f.paper.command(f.args("finish")) { _, error ->
                    finishError.set(error); finished.countDown()
                }
            }
            val other = f.command("capture") { owner = 2; key = "other"; requestId = 99 }
            assertFalse("Reject only the competing capture", other.optBoolean("ready", true))
            assertEquals("Keep the current owner's pending finish", 1L, finished.count)
            assertSame("Keep the current owner's GPU scene", canvas, f.nativeView())
            f.awaitNativeColor(Color.GREEN)
            f.color("lime")
            instrumentation.runOnMainSync {
                f.holdPresentation = false
                f.heldPresentations.toList().forEach { it() }; f.heldPresentations.clear()
            }
            assertTrue(finished.await(6, TimeUnit.SECONDS))
            assertNull(finishError.get())
            f.command("start") { key = "green"; destination = "red"; forward = false }
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.RED)
            f.color("red"); f.command("finish")
        }
    }

    @Test fun keepsTheRestoredPageCoveredUntilItsWebViewFrameIsReady() {
        Harness().use { f ->
            f.capture("current")
            f.command("cover") { key = "current" }
            f.awaitNativeColor(Color.RED)
            // Neighbour preparation changes the live WebView under the cover.
            f.color("lime"); f.capture("neighbour")
            assertEquals(Color.GREEN, f.activityPixel())
            val idle = CountDownLatch(1)
            instrumentation.runOnMainSync {
                f.holdPresentation = true
                f.paper.command(f.args("idle")) { _, _ -> idle.countDown() }
                assertEquals("Do not expose the previous preview before restoration is painted",
                    1f, f.nativeView().alpha, 0f)
                assertEquals("Idle must wait for the restored WebView frame", 1L, idle.count)
            }
            f.color("red")
            instrumentation.runOnMainSync {
                f.holdPresentation = false
                f.heldPresentations.toList().forEach { it() }
                f.heldPresentations.clear()
            }
            assertTrue(idle.await(6, TimeUnit.SECONDS))
            assertEquals(Color.RED, f.activityPixel())
        }
    }

    @Test fun preservesSinglePixelDetailAtFullPhoneResolution() {
        Harness().use { f ->
            val rows = 2339
            lateinit var canvas: NativePaperView
            lateinit var window: PopupWindow
            val rendered = CountDownLatch(1)
            val error = AtomicReference<Exception>()
            instrumentation.runOnMainSync {
                canvas = NativePaperView(f.activity)
                window = PopupWindow(canvas, w, rows, false).apply {
                    isClippingEnabled = false
                    showAtLocation(f.web, Gravity.TOP or Gravity.LEFT, 0, 0)
                }
                val image = Bitmap.createBitmap(w, rows, Bitmap.Config.ARGB_8888)
                val pixels = IntArray(w * rows) { if ((it / w) % 2 == 0) Color.BLACK else Color.WHITE }
                image.setPixels(pixels, 0, w, 0, 0, w, rows)
                canvas.upload("detail", image, { true }) { accepted, _, uploadError ->
                    if (!accepted || uploadError != null) { error.set(uploadError ?: Exception("Upload rejected")); rendered.countDown() }
                    else canvas.scene("detail", "detail", true, false, 0f, 0.5f, 1) {
                        error.set(it); rendered.countDown()
                    }
                }
            }
            try {
                assertTrue(rendered.await(6, TimeUnit.SECONDS)); assertNull(error.get())
                instrumentation.waitForIdleSync()
                instrumentation.runOnMainSync {
                    val image = canvas.bitmap!!
                    try {
                        assertEquals(rows, image.height)
                        for (y in 32 until rows - 32) {
                            val expected = if (y % 2 == 0) Color.BLACK else Color.WHITE
                            val actual = image.getPixel(w / 2, y)
                            assertTrue("Unblurred native row $y expected ${Integer.toHexString(expected)} actual ${Integer.toHexString(actual)}", absColor(expected, actual) <= 3)
                        }
                    } finally { image.recycle() }
                }
            } finally {
                instrumentation.runOnMainSync { window.dismiss(); canvas.dispose() }
            }
        }
    }

    @Test fun capturesThePageUnderTheNativeCoverWithoutReturningImageBytes() {
        Harness().use { f ->
            val metadata = f.capture("one")
            assertEquals("Source WebView pixels", Color.RED, f.activityPixel())
            assertTrue(metadata.getBoolean("ready")); assertFalse(metadata.has("data"))
            assertTrue(metadata.toString().length < 256)
            f.command("cover") { key = "one" }
            f.awaitNativeColor(Color.RED)
            f.color("rgb(0,255,0)")
            f.capture("two")
            f.awaitNativeColor(Color.RED) // Native cover did not capture itself.
            assertEquals(Color.GREEN, f.activityPixel())
            f.command("start") { key = "one"; destination = "two" }
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.GREEN)
            f.command("finish")
            assertEquals(Color.GREEN, f.activityPixel())
        }
    }

    @Test fun freezesTheLandedSheetWhileTheNextFingerArrivesBeforeLiveCommit() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green" }
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.GREEN)
            f.touch(MotionEvent.ACTION_DOWN, w - 5f)
            f.touch(MotionEvent.ACTION_MOVE, w - 41f)
            // The old live WebView is still red. A second finger must not
            // reopen that completed red leaf while its green cover is held.
            f.awaitNativeColor(Color.GREEN, 20, h / 2)
            f.touch(MotionEvent.ACTION_UP, w - 41f)
            f.command("move") { progress = 0.1f }
            f.awaitNativeColor(Color.GREEN, 20, h / 2)
            f.color("lime"); f.command("finish")
        }
    }

    @Test fun ignoresAnOldFinishAfterTheNextTurnHasStarted() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green"; turnId = 11 }
            f.command("animate") { commit = true; turnId = 11 }
            f.color("lime"); f.command("finish") { turnId = 11 }
            f.command("start") { key = "green"; destination = "red"; forward = false; turnId = 12 }
            f.command("finish") { turnId = 11 }
            instrumentation.runOnMainSync { assertEquals(1f, f.nativeView().alpha, 0f) }
            f.command("animate") { commit = true; turnId = 12 }
            f.awaitNativeColor(Color.RED)
            f.color("red"); f.command("finish") { turnId = 12 }
        }
    }

    @Test fun showsACurlWhenAFastFlickEndsBeforeTheNativeSceneStarts() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green"; progress = 1f; released = true }
            // With no finger left, a buffered 100% swipe used to start with
            // an empty leaf and skip animation entirely.
            val deadline = SystemClock.uptimeMillis() + 2000
            var visible = false
            while (!visible && SystemClock.uptimeMillis() < deadline) {
                val pixel = f.nativePixel(20, h / 2)
                visible = Color.red(pixel) > Color.green(pixel)
                if (!visible) Thread.sleep(16)
            }
            assertTrue("Fast released swipe still has a visible turning leaf", visible)
            f.command("animate") { commit = true; progress = 1f }
            f.awaitNativeColor(Color.GREEN)
            f.color("lime"); f.command("finish")
        }
    }

    @Test fun keepsFollowingJsMovesWhenTheNativeListenerMissedTheInitialDown() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            // A controller created during this touch has no native DOWN.
            f.command("start") { key = "red"; destination = "green"; progress = 0.1f }
            f.command("move") { progress = 0.5f }
            f.awaitNativeColor(Color.GREEN, 250, h / 2)
            f.command("animate") { commit = true; progress = 0.5f }
            f.color("lime"); f.command("finish")
        }
    }

    @Test fun aQueuedCompletionCannotSkipTheNextVisibleAnimation() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green"; progress = 0.2f; released = true }
            f.command("complete")
            val done = CountDownLatch(1)
            val error = AtomicReference<String>()
            instrumentation.runOnMainSync {
                f.paper.command(f.args("animate") { commit = true }) { _, message ->
                    error.set(message); done.countDown()
                }
                val animation = NativePaperTurn::class.java.getDeclaredField("animation").apply { isAccessible = true }
                assertNotNull("A quick following gesture must leave a visible settling animation", animation.get(f.paper))
                f.paper.command(f.args("complete")) { _, _ -> }
                val progress = NativePaperTurn::class.java.getDeclaredField("progress").apply { isAccessible = true }
                assertEquals("Repeated input must not snap the leaf straight to its final pose",
                    0.2f, progress.getFloat(f.paper), 0.001f)
            }
            assertTrue(done.await(4, TimeUnit.SECONDS)); assertNull(error.get())
            f.awaitNativeColor(Color.GREEN)
            f.color("lime"); f.command("finish")
        }
    }

    @Test fun everyTapPresentsCurvedFramesEvenWhenTheGlWorkerFallsBehind() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            for (turn in 0 until 3) {
                val forward = turn % 2 == 0
                f.command("start") {
                    key = if (forward) "red" else "green"
                    destination = if (forward) "green" else "red"
                    this.forward = forward; released = true
                }
                val curved = java.util.concurrent.atomic.AtomicInteger()
                val blocked = CountDownLatch(1)
                val release = CountDownLatch(1)
                val done = CountDownLatch(1)
                val error = AtomicReference<String>()
                instrumentation.runOnMainSync {
                    val canvas = f.nativeView()
                    canvas.surfaceTextureListener = object : android.view.TextureView.SurfaceTextureListener {
                        override fun onSurfaceTextureAvailable(t: android.graphics.SurfaceTexture, w: Int, h: Int) = canvas.onSurfaceTextureAvailable(t, w, h)
                        override fun onSurfaceTextureSizeChanged(t: android.graphics.SurfaceTexture, w: Int, h: Int) = canvas.onSurfaceTextureSizeChanged(t, w, h)
                        override fun onSurfaceTextureDestroyed(t: android.graphics.SurfaceTexture) = canvas.onSurfaceTextureDestroyed(t)
                        override fun onSurfaceTextureUpdated(t: android.graphics.SurfaceTexture) {
                            val image = canvas.bitmap!!
                            try {
                                val first = image.getPixel(w / 8, h / 2)
                                if ((2..6).any { absColor(first, image.getPixel(w * it / 8, h / 2)) > 10 }) curved.incrementAndGet()
                            } finally { image.recycle() }
                            canvas.onSurfaceTextureUpdated(t)
                        }
                    }
                    val worker = NativePaperView::class.java.getDeclaredField("worker").apply { isAccessible = true }.get(canvas) as Handler
                    worker.post { blocked.countDown(); release.await(2, TimeUnit.SECONDS) }
                    f.paper.command(f.args("animate") { commit = true }) { _, message -> error.set(message); done.countDown() }
                    f.paper.command(f.args("complete")) { _, _ -> }
                }
                assertTrue(blocked.await(2, TimeUnit.SECONDS))
                Thread.sleep(200) // Longer than the accelerated animation's whole clock.
                release.countDown()
                assertTrue(done.await(4, TimeUnit.SECONDS)); assertNull(error.get())
                assertTrue("Tap $turn must present multiple curved frames, not just its final page", curved.get() >= 2)
                f.color(if (forward) "lime" else "red"); f.command("finish")
            }
        }
    }

    @Test fun cancellingAnUnpresentedFrameDoesNotCompleteTheFollowingTurn() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green"; progress = 0.2f }
            val release = CountDownLatch(1)
            val done = CountDownLatch(1)
            val result = AtomicReference<JSObject>()
            instrumentation.runOnMainSync {
                val worker = NativePaperView::class.java.getDeclaredField("worker").apply { isAccessible = true }.get(f.nativeView()) as Handler
                worker.post { release.await(2, TimeUnit.SECONDS) }
                f.paper.command(f.args("animate") { commit = true }) { value, _ -> result.set(value); done.countDown() }
            }
            Thread.sleep(40)
            f.command("cancel")
            release.countDown()
            assertTrue(done.await(4, TimeUnit.SECONDS))
            assertTrue(result.get().getBoolean("cancelled"))
            f.awaitNativeColor(Color.RED); f.command("finish")
            f.command("start") { key = "red"; destination = "green"; turnId = 1 }
            f.command("animate") { commit = true; turnId = 1 }
            f.awaitNativeColor(Color.GREEN)
            f.color("lime"); f.command("finish") { turnId = 1 }
        }
    }

    @Test fun startsFallbackSettlementAtTheVisiblePoseInsteadOfJumpingToAQueuedRelease() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            f.command("start") { key = "red"; destination = "green"; progress = 0.1f }
            f.command("move") { progress = 0.4f }
            val done = CountDownLatch(1)
            val error = AtomicReference<String>()
            var startProgress = -1f
            instrumentation.runOnMainSync {
                f.paper.command(f.args("animate") { commit = true; progress = 1f }) { _, message ->
                    error.set(message); done.countDown()
                }
                val field = NativePaperTurn::class.java.getDeclaredField("progress").apply { isAccessible = true }
                startProgress = field.getFloat(f.paper)
            }
            assertTrue(done.await(4, TimeUnit.SECONDS)); assertNull(error.get())
            f.awaitNativeColor(Color.GREEN)
            assertEquals("Settlement starts at the visible leaf, not the queued 100% release", 0.4f, startProgress, 0.001f)
            f.color("lime"); f.command("finish")
        }
    }

    @Test fun followsNativeTouchAndKeepsThePreviousSheetUntilTheLivePageIsPresented() {
        Harness().use { f ->
            f.capture("one"); f.command("cover") { key = "one" }
            f.color("rgb(0,255,0)"); f.capture("two"); f.color("red")
            f.touch(MotionEvent.ACTION_DOWN, w - 5f)
            val started = f.command("start") { key = "one"; destination = "two" }
            assertTrue(started.getBoolean("touchTracked"))
            f.touch(MotionEvent.ACTION_MOVE, w * 0.4f)
            f.awaitNativeColor(Color.GREEN, w - 5, h / 2) // No JS move command.
            f.touch(MotionEvent.ACTION_UP, w * 0.4f)
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.GREEN)
            f.color("rgb(0,255,0)"); f.command("finish")

            f.command("start") { key = "two"; destination = "one"; forward = false }
            f.awaitNativeColor(Color.GREEN)
            f.command("animate") { commit = true }
            f.awaitNativeColor(Color.RED)
            assertEquals(Color.GREEN, f.activityPixel()) // Old live page still covered.
            f.color("red"); f.command("finish")
            assertEquals(Color.RED, f.activityPixel())
            instrumentation.runOnMainSync { assertTrue(f.nativeView().alpha < 0.01f) }
        }
    }

    @Test fun cancelsAnInFlightNativeCaptureWithoutAResultBitmap() {
        Harness().use { f ->
            val completed = CountDownLatch(2)
            val captured = AtomicReference<JSObject>()
            val error = AtomicReference<String>()
            instrumentation.runOnMainSync {
                f.paper.command(f.args("capture") { key = "obsolete"; requestId = 41 }) { result, message ->
                    captured.set(result); if (message != null) error.set(message); completed.countDown()
                }
                f.paper.command(f.args("abortCapture") { requestId = 41 }) { _, message ->
                    if (message != null) error.set(message); completed.countDown()
                }
            }
            assertTrue(completed.await(3, TimeUnit.SECONDS)); assertNull(error.get())
            assertFalse(captured.get().getBoolean("ready"))
            assertFalse(captured.get().has("data"))
            f.capture("one"); f.command("cover") { key = "one" }; f.awaitNativeColor(Color.RED)
        }
    }

    @Test fun honoursCancellationThatArrivesBeforeTheFirstCapture() {
        Harness().use { f ->
            f.command("abortCapture") { requestId = 42 }
            val cancelled = f.command("capture") { key = "obsolete"; requestId = 42 }
            assertFalse(cancelled.getBoolean("ready"))
            f.capture("current"); f.command("cover") { key = "current" }
            f.awaitNativeColor(Color.RED)
        }
    }

    @Test fun aStaleReplacementUploadKeepsTheResidentPage() {
        Harness().use { f ->
            f.capture("current")
            // The replacement is valid when its upload starts and stale once
            // its pixels are on the GPU.
            val done = CountDownLatch(1)
            var accepted = true
            var keys = emptyList<String>()
            instrumentation.runOnMainSync {
                val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
                var checks = 0
                f.nativeView().upload("current", bitmap, { checks++ == 0 }) { ok, resident, _ ->
                    accepted = ok; keys = resident; done.countDown()
                }
            }
            assertTrue(done.await(3, TimeUnit.SECONDS))
            assertFalse(accepted)
            assertTrue("The resident page stays in the bank", "current" in keys)
            f.command("cover") { key = "current" }
            f.awaitNativeColor(Color.RED)
        }
    }

    @Test fun removesAnUploadedAbortedPageBeforeReportingTheTextureBank() {
        Harness().use { f ->
            f.capture("obsolete")
            f.command("abortCapture") { requestId = f.request }
            val next = f.capture("current")
            assertFalse(next.getJSONArray("keys").toString().contains("obsolete"))
            f.command("cover") { key = "current" }
            f.awaitNativeColor(Color.RED)
            for (key in listOf("next", "previous", "extra")) {
                val metadata = f.capture(key)
                assertTrue(metadata.getJSONArray("keys").length() <= 3)
            }
        }
    }

    @Test fun repeatedlyCompletesAnimationTailsWithoutExposingTheOldLivePage() {
        Harness().use { f ->
            f.capture("red"); f.command("cover") { key = "red" }
            f.color("lime"); f.capture("green"); f.color("red")
            for (turn in 0 until 8) {
                val forwards = turn % 2 == 0
                val source = if (forwards) "red" else "green"
                val target = if (forwards) "green" else "red"
                f.command("start") { key = source; destination = target; forward = forwards }
                val done = CountDownLatch(2)
                val error = AtomicReference<String>()
                instrumentation.runOnMainSync {
                    for (op in listOf("animate", "complete")) {
                        f.paper.command(f.args(op) { commit = true }) { _, message ->
                            if (message != null) error.set(message)
                            done.countDown()
                        }
                    }
                }
                assertTrue(done.await(4, TimeUnit.SECONDS)); assertNull(error.get())
                f.awaitNativeColor(if (forwards) Color.GREEN else Color.RED)
                assertEquals(if (forwards) Color.RED else Color.GREEN, f.activityPixel())
                f.color(if (forwards) "lime" else "red")
                f.command("finish")
                assertEquals(if (forwards) Color.GREEN else Color.RED, f.activityPixel())
            }
        }
    }
}
