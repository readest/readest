package com.readest.native_bridge

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.CookieManager
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
import java.lang.ref.WeakReference

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
    // Interactive mode: show the page with a Cancel/Capture bar instead
    // of the opaque overlay so the user can sign in before capturing.
    var interactive: Boolean? = null
    var signInHint: String? = null
    var captureLabel: String? = null
    var cancelLabel: String? = null
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
    activity: Activity,
    private val args: ClipUrlArgs,
    private val completion: (ClipUrlResult) -> Unit,
) {
    // Hold the Activity weakly: the controller outlives the synchronous
    // command call (it waits up to 30 s for the page), and a strong ref
    // would leak the Activity (and its WebView) if it is destroyed while
    // a clip is in flight.
    private val activityRef = WeakReference(activity)

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
        private const val DEFAULT_SIGN_IN_HINT = "Sign in if needed, then capture"
        private const val DEFAULT_CAPTURE_LABEL = "Capture"
        private const val DEFAULT_CANCEL_LABEL = "Cancel"

        // Shared cancel vocabulary with `ClipUrlController.swift` — the JS
        // side matches this string to stay quiet on user-initiated cancels.
        const val CANCELLED_MESSAGE = "Capture cancelled"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val interactiveMode = args.interactive == true
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
        val act = activityRef.get()
        if (act == null || act.isFinishing || act.isDestroyed) {
            completion(ClipUrlResult.Failure("Activity is no longer available"))
            return
        }
        mainHandler.post { presentDialog(act, urlStr) }
    }

    private fun presentDialog(act: Activity, urlStr: String) {
        val bg = parseHexColor(args.background ?: DEFAULT_BACKGROUND) ?: Color.BLACK
        val fg = parseHexColor(args.foreground ?: DEFAULT_FOREGROUND) ?: Color.WHITE

        // Headless: full-screen dialog with no chrome — we draw our own
        // overlay on top so the underlying app doesn't peek through during
        // the brief capture window. Interactive: keep the status bar (the
        // fullscreen theme breaks adjustResize, and the user has to type
        // credentials) and let the user drive the page.
        val theme = if (interactiveMode) {
            android.R.style.Theme_Black_NoTitleBar
        } else {
            android.R.style.Theme_Black_NoTitleBar_Fullscreen
        }
        val dlg = Dialog(act, theme)
        dlg.setCancelable(interactiveMode)
        dlg.setCanceledOnTouchOutside(false)
        dlg.window?.also { window ->
            window.setBackgroundDrawable(ColorDrawable(bg))
        }

        val wv = WebView(act)
        configureWebView(wv)

        val root: View
        if (interactiveMode) {
            dlg.setOnCancelListener { finish(ClipUrlResult.Failure(CANCELLED_MESSAGE)) }
            dlg.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            // Back navigates the page history first — sign-in flows hop
            // through several redirects — and only cancels once exhausted.
            dlg.setOnKeyListener { _, keyCode, event ->
                if (keyCode == KeyEvent.KEYCODE_BACK &&
                    event.action == KeyEvent.ACTION_UP && wv.canGoBack()
                ) {
                    wv.goBack()
                    true
                } else {
                    false
                }
            }
            val column = LinearLayout(act)
            column.orientation = LinearLayout.VERTICAL
            column.setBackgroundColor(bg)
            column.addView(
                buildActionBar(act, bg, fg),
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
            column.addView(
                wv,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
            )
            root = column
        } else {
            val frame = FrameLayout(act)
            frame.setBackgroundColor(bg)
            // Reserve a logical size for layout; the WebView is hidden
            // behind the opaque overlay anyway, but it still needs a
            // non-zero rect for the page to fire its viewport-based
            // lazy-loaders.
            wv.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            frame.addView(wv)
            val overlay = buildOverlay(act, bg, fg)
            overlay.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            frame.addView(overlay)
            root = frame
        }

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

        // Interactive capture waits for the user's tap — no deadline.
        if (!interactiveMode) {
            mainHandler.postDelayed(timeoutRunnable, HARD_TIMEOUT_MS)
        }
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

        // The CookieManager is app-wide and persistent, so a session the
        // user establishes in the interactive capture flow authenticates
        // every later headless clip. Third-party cookies are required by
        // most SSO redirects (#5262).
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(wv, true)

        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                // Interactive capture is user-driven: the page keeps
                // navigating (login redirects) until Capture is tapped.
                if (interactiveMode) return
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
                // A failed hop mid-sign-in shouldn't tear the flow down —
                // the page renders its own error and the user can retry
                // or cancel.
                if (interactiveMode) return
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

    /** Interactive-mode top bar: hint text + Cancel + a solid Capture
     *  button, all drawn with the caller's theme colours. */
    private fun buildActionBar(act: Activity, bg: Int, fg: Int): View {
        val bar = LinearLayout(act)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setBackgroundColor(bg)
        bar.setPadding(dp(act, 16), dp(act, 10), dp(act, 12), dp(act, 10))

        val hint = TextView(act)
        hint.text = args.signInHint ?: DEFAULT_SIGN_IN_HINT
        hint.setTextColor(
            Color.argb((0.7f * 255).toInt(), Color.red(fg), Color.green(fg), Color.blue(fg)),
        )
        hint.textSize = 13f
        hint.maxLines = 2
        hint.ellipsize = TextUtils.TruncateAt.END
        val hintParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        hintParams.marginEnd = dp(act, 12)
        hint.layoutParams = hintParams
        bar.addView(hint)

        val cancel = TextView(act)
        cancel.text = args.cancelLabel ?: DEFAULT_CANCEL_LABEL
        cancel.setTextColor(fg)
        cancel.textSize = 14f
        cancel.setPadding(dp(act, 12), dp(act, 8), dp(act, 12), dp(act, 8))
        cancel.setOnClickListener { finish(ClipUrlResult.Failure(CANCELLED_MESSAGE)) }
        bar.addView(cancel)

        val capture = TextView(act)
        capture.text = args.captureLabel ?: DEFAULT_CAPTURE_LABEL
        capture.setTextColor(bg)
        capture.textSize = 14f
        capture.setTypeface(capture.typeface, android.graphics.Typeface.BOLD)
        capture.setPadding(dp(act, 16), dp(act, 8), dp(act, 16), dp(act, 8))
        val pill = GradientDrawable()
        pill.setColor(fg)
        pill.cornerRadius = dp(act, 18).toFloat()
        capture.background = pill
        val captureParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        captureParams.marginStart = dp(act, 4)
        capture.layoutParams = captureParams
        capture.setOnClickListener { captureOuterHtml() }
        bar.addView(capture)

        return bar
    }

    private fun buildOverlay(act: Activity, bg: Int, fg: Int): View {
        val column = LinearLayout(act)
        column.orientation = LinearLayout.VERTICAL
        column.gravity = Gravity.CENTER
        column.setBackgroundColor(bg)
        val pad = dp(act, 24)
        column.setPadding(pad, pad, pad, pad)

        val spinner = ProgressBar(act)
        // Tint with foreground at ~85% — same idea as the iOS overlay.
        val spinTint = Color.argb(
            (0.85f * 255).toInt(),
            Color.red(fg), Color.green(fg), Color.blue(fg),
        )
        spinner.indeterminateDrawable?.setTint(spinTint)
        val spinSize = dp(act, 36)
        val spinParams = LinearLayout.LayoutParams(spinSize, spinSize)
        spinParams.bottomMargin = dp(act, 14)
        spinner.layoutParams = spinParams
        column.addView(spinner)

        val title = TextView(act)
        title.text = args.overlayTitle ?: DEFAULT_OVERLAY_TITLE
        title.setTextColor(fg)
        title.textSize = 15f
        title.gravity = Gravity.CENTER
        title.setTypeface(title.typeface, android.graphics.Typeface.BOLD)
        column.addView(title)

        val status = TextView(act)
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
        statusParams.topMargin = dp(act, 4)
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
            // Persist any session the page established (interactive
            // sign-in) so later headless clips reuse it.
            CookieManager.getInstance().flush()
        } catch (e: Exception) {
            Log.w(TAG, "error flushing cookies after clip_url", e)
        }
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

    private fun dp(act: Activity, units: Int): Int =
        (units * act.resources.displayMetrics.density + 0.5f).toInt()

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
