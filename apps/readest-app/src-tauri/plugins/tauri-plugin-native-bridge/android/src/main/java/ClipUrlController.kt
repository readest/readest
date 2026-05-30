package com.readest.native_bridge

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import app.tauri.annotation.InvokeArg
import org.json.JSONObject

/**
 * Args decoded from the JS `invoke('clip_url', { ... })` payload.
 * Mirrors `ClipOptions` in `clip_url.rs` field-for-field. Defaults
 * are applied in `ClipUrlController` so a caller that omits a field
 * still renders sensibly.
 */
@InvokeArg
class ClipUrlArgs {
    var url: String? = null
    var windowTitle: String? = null
    var overlayTitle: String? = null
    var loadingStatus: String? = null
    var capturingStatus: String? = null
    var savedTitle: String? = null
    var background: String? = null
    var foreground: String? = null
}

/**
 * Result handed back to the calling [NativeBridgePlugin.clip_url] —
 * either the captured `document.documentElement.outerHTML`, or one of
 * the error strings the JS layer surfaces verbatim. The error
 * vocabulary matches the desktop `clip_url` Rust impl so callers
 * handling the rejection don't need a mobile-specific branch.
 */
sealed class ClipUrlResult {
    data class Success(val html: String) : ClipUrlResult()
    data class Failure(val message: String) : ClipUrlResult()
}

/**
 * Full-screen Dialog that loads `args.url` in a `WebView`, shows a
 * "Saving…" overlay over the article render (so the user sees a
 * deliberate progress state, not a website flashing by), waits for
 * `onPageFinished` + a 3 s settle window, then captures
 * `document.documentElement.outerHTML` via `evaluateJavascript`.
 *
 * Mirrors the desktop `clip_url` flow shape: same Chrome UA, same
 * fingerprint mask, same overlay (rendered as native views here
 * instead of an injected user script — gives us a real spinner that
 * the page's own hydration can't wipe).
 */
class ClipUrlController(
    private val activity: Activity,
    private val args: ClipUrlArgs,
    private val completion: (ClipUrlResult) -> Unit,
) {
    companion object {
        private const val TAG = "ClipUrl"

        // Real Chrome UA — same string as the Rust desktop flow uses.
        const val BROWSER_USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

        // Total budget from load-start to outerHTML capture, in ms.
        const val HARD_TIMEOUT_MS: Long = 30_000
        // Settle delay after onPageFinished so IntersectionObserver-based
        // lazy-loaders fire for content already in the viewport.
        const val LOAD_SETTLE_MS: Long = 3_000

        // Mirrors `fingerprint_mask_script()` in `clip_url.rs`. Clears
        // the obvious bot-detection signals before any page script runs.
        private const val FINGERPRINT_MASK_JS = """
            (function() {
              try {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
              } catch (e) {}
              try {
                if (!window.chrome) { window.chrome = { runtime: {} }; }
              } catch (e) {}
              try {
                if (navigator.languages && navigator.languages.length === 0) {
                  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                }
              } catch (e) {}
            })();
        """

        // Defaults match `ClipOptions::*()` accessors on the Rust side.
        private const val DEFAULT_OVERLAY_TITLE = "Saving to Readest"
        private const val DEFAULT_LOADING_STATUS = "Loading article…"
        private const val DEFAULT_CAPTURING_STATUS = "Capturing article…"
        private const val DEFAULT_BACKGROUND = "#1f2024"
        private const val DEFAULT_FOREGROUND = "#f5f5f7"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var dialog: Dialog? = null
    private var webView: WebView? = null
    private var statusLabel: TextView? = null
    private var didFinishOrFail = false
    private var captureFired = false
    private var settled = false
    private val timeoutRunnable = Runnable { onTimeout() }

    fun show() {
        val urlStr = args.url
        if (urlStr.isNullOrBlank() || !(urlStr.startsWith("http://") || urlStr.startsWith("https://"))) {
            completion(ClipUrlResult.Failure("Invalid URL"))
            return
        }
        mainHandler.post { presentDialog(urlStr) }
    }

    private fun presentDialog(urlStr: String) {
        val bg = parseHexColor(args.background ?: DEFAULT_BACKGROUND) ?: Color.BLACK
        val fg = parseHexColor(args.foreground ?: DEFAULT_FOREGROUND) ?: Color.WHITE

        // Full-screen dialog with no chrome — we draw our own overlay
        // on top so the underlying app doesn't peek through during the
        // brief capture window.
        val dlg = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dlg.setCancelable(false)
        dlg.setCanceledOnTouchOutside(false)
        dlg.window?.also { window ->
            window.setBackgroundDrawable(ColorDrawable(bg))
        }

        val root = FrameLayout(activity)
        root.setBackgroundColor(bg)

        val wv = WebView(activity)
        // Reserve a logical size for layout; the WebView is hidden
        // behind the opaque overlay anyway, but it still needs a
        // non-zero rect for the page to fire its viewport-based
        // lazy-loaders.
        wv.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        configureWebView(wv)
        root.addView(wv)

        val overlay = buildOverlay(bg, fg)
        overlay.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        root.addView(overlay)

        dlg.setContentView(
            root,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        dlg.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        dlg.show()

        dialog = dlg
        webView = wv

        // Inject the fingerprint mask before the first navigation so
        // navigator.webdriver and friends look right when the page's
        // own scripts run.
        wv.evaluateJavascript(FINGERPRINT_MASK_JS, null)
        wv.loadUrl(urlStr)

        mainHandler.postDelayed(timeoutRunnable, HARD_TIMEOUT_MS)
    }

    private fun configureWebView(wv: WebView) {
        val settings: WebSettings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.userAgentString = BROWSER_USER_AGENT
        settings.loadsImagesAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        wv.setBackgroundColor(parseHexColor(args.background ?: DEFAULT_BACKGROUND) ?: Color.BLACK)

        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                if (didFinishOrFail) return
                didFinishOrFail = true
                mainHandler.post {
                    statusLabel?.text = args.capturingStatus ?: DEFAULT_CAPTURING_STATUS
                }
                // Settle then capture. Matches the 3 s post-load delay
                // in the desktop init script.
                mainHandler.postDelayed({ captureOuterHtml() }, LOAD_SETTLE_MS)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // Only honour main-frame errors. Subresource failures
                // (a single missing image, a blocked tracker) shouldn't
                // abort the capture — they were noise the desktop flow
                // tolerated too.
                if (request?.isForMainFrame != true) return
                if (didFinishOrFail) return
                didFinishOrFail = true
                val detail = error?.description?.toString() ?: "load failed"
                finish(ClipUrlResult.Failure("Could not fetch this page: $detail"))
            }
        }
    }

    private fun buildOverlay(bg: Int, fg: Int): View {
        val column = LinearLayout(activity)
        column.orientation = LinearLayout.VERTICAL
        column.gravity = Gravity.CENTER
        column.setBackgroundColor(bg)
        val pad = dp(24)
        column.setPadding(pad, pad, pad, pad)

        val spinner = ProgressBar(activity)
        // Tint with foreground at ~85% — same idea as the iOS overlay.
        val spinTint = Color.argb(
            (0.85f * 255).toInt(),
            Color.red(fg), Color.green(fg), Color.blue(fg),
        )
        spinner.indeterminateDrawable?.setTint(spinTint)
        val spinSize = dp(36)
        val spinParams = LinearLayout.LayoutParams(spinSize, spinSize)
        spinParams.bottomMargin = dp(14)
        spinner.layoutParams = spinParams
        column.addView(spinner)

        val title = TextView(activity)
        title.text = args.overlayTitle ?: DEFAULT_OVERLAY_TITLE
        title.setTextColor(fg)
        title.textSize = 15f
        title.gravity = Gravity.CENTER
        title.setTypeface(title.typeface, android.graphics.Typeface.BOLD)
        column.addView(title)

        val status = TextView(activity)
        status.text = args.loadingStatus ?: DEFAULT_LOADING_STATUS
        // 70% alpha for the secondary line — matches the desktop overlay.
        status.setTextColor(
            Color.argb(
                (0.7f * 255).toInt(),
                Color.red(fg), Color.green(fg), Color.blue(fg),
            ),
        )
        status.textSize = 13f
        status.gravity = Gravity.CENTER
        status.maxLines = 1
        status.ellipsize = TextUtils.TruncateAt.END
        val statusParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        statusParams.topMargin = dp(4)
        status.layoutParams = statusParams
        column.addView(status)
        statusLabel = status

        return column
    }

    private fun captureOuterHtml() {
        if (captureFired) return
        captureFired = true
        settled = true
        val wv = webView ?: return finish(ClipUrlResult.Failure("WebView vanished before capture"))
        wv.evaluateJavascript("document.documentElement.outerHTML") { result ->
            // `evaluateJavascript` returns the value JSON-encoded, so
            // an HTML string comes back wrapped in quotes with escapes.
            // Parse via JSONObject to recover the raw HTML.
            val html = try {
                JSONObject("{\"v\":$result}").getString("v")
            } catch (e: Exception) {
                Log.w(TAG, "failed to decode captured HTML", e)
                ""
            }
            if (html.isEmpty()) {
                finish(ClipUrlResult.Failure("Could not fetch this page: empty HTML"))
            } else {
                Log.d(TAG, "captured ${html.length} chars")
                finish(ClipUrlResult.Success(html))
            }
        }
    }

    private fun onTimeout() {
        if (captureFired || settled) return
        Log.w(TAG, "clip_url: hard timeout after ${HARD_TIMEOUT_MS}ms")
        finish(ClipUrlResult.Failure("Page took too long to load"))
    }

    private fun finish(result: ClipUrlResult) {
        mainHandler.removeCallbacks(timeoutRunnable)
        try {
            webView?.stopLoading()
            webView?.webViewClient = WebViewClient()  // detach our delegate
            dialog?.dismiss()
        } catch (e: Exception) {
            Log.w(TAG, "error tearing down clip_url dialog", e)
        }
        dialog = null
        webView = null
        completion(result)
    }

    private fun dp(units: Int): Int =
        (units * activity.resources.displayMetrics.density + 0.5f).toInt()

    /** Parse `#rrggbb` into an Android ARGB int; null on malformed input. */
    private fun parseHexColor(s: String): Int? {
        val hex = s.trim().removePrefix("#")
        if (hex.length != 6) return null
        return try {
            val v = hex.toLong(16).toInt()
            Color.rgb((v shr 16) and 0xff, (v shr 8) and 0xff, v and 0xff)
        } catch (_: NumberFormatException) {
            null
        }
    }
}
