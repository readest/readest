package com.readest.native_bridge

import android.app.Activity
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.InvokeArg
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL

/** Mirrors `WebBrowserRequest` in the plugin's models.rs. */
@InvokeArg
class WebBrowserArgs {
    var url: String? = null
    var downloadDir: String? = null
    var background: String? = null
    var foreground: String? = null
    var isEink: Boolean? = null
    var labels: Map<String, String>? = null
}

@InvokeArg
class WebBrowserStatusArgs {
    var state: String? = null
    var filename: String? = null
    var bookHash: String? = null
}

data class WebBrowserDownloadEvent(
    val url: String,
    val path: String,
    val filename: String,
    val success: Boolean,
    val error: String?,
)

/**
 * Full-screen in-app browser (#5775): header bar (close, back, title + host,
 * reload/stop, menu), 2 dp progress line, import-status banner and a
 * `WebView` on the app-wide persistent `CookieManager`. Downloads are caught
 * by `DownloadListener`, fetched with the page's cookies into
 * `args.downloadDir`, and handed to the plugin as events.
 */
class WebBrowserController(
    activity: Activity,
    private val args: WebBrowserArgs,
    private val onDownload: (WebBrowserDownloadEvent) -> Unit,
    private val completion: (String?) -> Unit,
) {
    companion object {
        private const val TAG = "WebBrowser"
        private const val BAR_HEIGHT_DP = 52
        private const val BANNER_HIDE_MS = 8_000L
        private const val MENU_FORWARD = 1
        private const val MENU_OPEN_EXTERNAL = 2
        private const val MENU_COPY_LINK = 3
        private const val MENU_SIGN_OUT = 4
    }

    private val activityRef = WeakReference(activity)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val bg = parseHexColor(args.background) ?: Color.parseColor("#1f2024")
    private val fg = parseHexColor(args.foreground) ?: Color.parseColor("#f5f5f7")
    private val eink = args.isEink == true

    private var dialog: Dialog? = null
    private var webView: WebView? = null
    private var backButton: ImageButton? = null
    private var reloadButton: ImageButton? = null
    private var menuButton: ImageButton? = null
    private var titleView: TextView? = null
    private var hostView: TextView? = null
    private var progressView: View? = null
    private var progressContainer: FrameLayout? = null
    private var banner: LinearLayout? = null
    private var bannerText: TextView? = null
    private var bannerOpen: TextView? = null
    private var openBookHash: String? = null
    private var loading = false
    private var finished = false
    private val hideBannerRunnable = Runnable { banner?.visibility = View.GONE }

    private fun label(key: String, fallback: String): String =
        args.labels?.get(key)?.takeIf { it.isNotEmpty() } ?: fallback

    fun show() {
        val urlStr = args.url
        if (urlStr.isNullOrBlank() || !(urlStr.startsWith("http://") || urlStr.startsWith("https://"))) {
            completion(null)
            return
        }
        val act = activityRef.get()
        if (act == null || act.isFinishing || act.isDestroyed) {
            completion(null)
            return
        }
        mainHandler.post { present(act, urlStr) }
    }

    private fun present(act: Activity, urlStr: String) {
        // Keep the status bar: the fullscreen theme breaks adjustResize and
        // the user has to type credentials into sign-in forms.
        val dlg = Dialog(act, android.R.style.Theme_Black_NoTitleBar)
        dlg.setCancelable(false)
        dlg.setCanceledOnTouchOutside(false)
        dlg.window?.also { window ->
            window.setBackgroundDrawable(ColorDrawable(bg))
            window.statusBarColor = bg
            WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = isLight(bg)
        }
        // Hardware back walks the page history first and only closes the
        // browser once it is exhausted.
        dlg.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                val wv = webView
                if (wv != null && wv.canGoBack()) wv.goBack() else finish(null)
                true
            } else {
                false
            }
        }

        val root = LinearLayout(act)
        root.orientation = LinearLayout.VERTICAL
        root.setBackgroundColor(bg)
        root.fitsSystemWindows = true

        root.addView(buildBar(act), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(act, BAR_HEIGHT_DP)))
        root.addView(buildProgress(act), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(act, 2)))
        root.addView(buildBanner(act), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(act, 44)))

        val wv = WebView(act)
        configureWebView(act, wv)
        root.addView(wv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        webView = wv

        dlg.setContentView(root)
        dialog = dlg
        dlg.show()
        wv.loadUrl(urlStr)
    }

    // MARK: chrome

    private fun iconButton(act: Activity, drawable: Int, description: String, onClick: () -> Unit): ImageButton {
        val button = ImageButton(act)
        button.setImageResource(drawable)
        button.imageTintList = ColorStateList.valueOf(fg)
        button.background = null
        button.contentDescription = description
        button.scaleType = android.widget.ImageView.ScaleType.CENTER
        button.layoutParams = LinearLayout.LayoutParams(dp(act, 48), dp(act, 48))
        button.setOnClickListener { onClick() }
        return button
    }

    private fun buildBar(act: Activity): View {
        val bar = LinearLayout(act)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setBackgroundColor(bg)
        bar.setPaddingRelative(dp(act, 2), 0, dp(act, 2), 0)

        bar.addView(iconButton(act, R.drawable.ic_browser_close, label("close", "Close")) { finish(null) })
        backButton = iconButton(act, R.drawable.ic_browser_back, label("back", "Back")) {
            webView?.let { if (it.canGoBack()) it.goBack() }
        }
        // Hidden (not dimmed) while there is no history: e-ink has no hover
        // and dimmed controls read as broken there.
        backButton?.visibility = View.INVISIBLE
        bar.addView(backButton)

        val titles = LinearLayout(act)
        titles.orientation = LinearLayout.VERTICAL
        titles.gravity = Gravity.CENTER
        val titlesParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        titles.layoutParams = titlesParams
        titleView = TextView(act).apply {
            setTextColor(fg)
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            gravity = Gravity.CENTER
        }
        hostView = TextView(act).apply {
            setTextColor(if (eink) fg else Color.argb(178, Color.red(fg), Color.green(fg), Color.blue(fg)))
            textSize = 12f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.MIDDLE
            gravity = Gravity.CENTER
        }
        titles.addView(titleView)
        titles.addView(hostView)
        bar.addView(titles)

        reloadButton = iconButton(act, R.drawable.ic_browser_refresh, label("reload", "Reload")) {
            webView?.let { if (loading) it.stopLoading() else it.reload() }
        }
        bar.addView(reloadButton)
        menuButton = iconButton(act, R.drawable.ic_browser_more, label("menu", "More")) { showMenu(act) }
        bar.addView(menuButton)
        return bar
    }

    private fun buildProgress(act: Activity): View {
        val container = FrameLayout(act)
        container.setBackgroundColor(if (eink) fg else Color.argb(38, Color.red(fg), Color.green(fg), Color.blue(fg)))
        val line = View(act)
        line.setBackgroundColor(fg)
        line.layoutParams = FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT)
        container.addView(line)
        progressView = line
        progressContainer = container
        return container
    }

    private fun buildBanner(act: Activity): View {
        val row = LinearLayout(act)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        row.visibility = View.GONE
        row.setPaddingRelative(dp(act, 16), 0, dp(act, 12), 0)
        val background = GradientDrawable()
        background.setColor(if (eink) bg else Color.argb(20, Color.red(fg), Color.green(fg), Color.blue(fg)))
        if (eink) background.setStroke(dp(act, 1), fg)
        row.background = background

        bannerText = TextView(act).apply {
            setTextColor(fg)
            textSize = 13f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.MIDDLE
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(bannerText)

        bannerOpen = TextView(act).apply {
            text = label("open", "Open")
            setTextColor(bg)
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(act, 14), dp(act, 6), dp(act, 14), dp(act, 6))
            val pill = GradientDrawable()
            pill.setColor(fg)
            pill.cornerRadius = dp(act, 16).toFloat()
            this.background = pill
            visibility = View.GONE
            setOnClickListener { finish(openBookHash) }
        }
        row.addView(bannerOpen)
        banner = row
        return row
    }

    private fun showMenu(act: Activity) {
        val anchor = menuButton ?: return
        val wv = webView ?: return
        val popup = PopupMenu(act, anchor)
        popup.menu.add(0, MENU_FORWARD, 0, label("forward", "Forward")).isEnabled = wv.canGoForward()
        popup.menu.add(0, MENU_OPEN_EXTERNAL, 1, label("openInBrowser", "Open in Browser"))
        popup.menu.add(0, MENU_COPY_LINK, 2, label("copyLink", "Copy Link"))
        popup.menu.add(0, MENU_SIGN_OUT, 3, label("signOut", "Sign out of this site"))
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_FORWARD -> wv.goForward()
                MENU_OPEN_EXTERNAL -> wv.url?.let { openExternal(act, it) }
                MENU_COPY_LINK -> wv.url?.let {
                    val clipboard = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("url", it))
                }
                MENU_SIGN_OUT -> signOutOfSite(wv)
            }
            true
        }
        popup.show()
    }

    private fun openExternal(act: Activity, url: String) {
        try {
            act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Log.w(TAG, "no activity for $url", e)
        }
    }

    /** Expire this site's cookies only; the jar is shared with Readest itself. */
    private fun signOutOfSite(wv: WebView) {
        val url = wv.url ?: return
        val host = Uri.parse(url).host ?: return
        val cm = CookieManager.getInstance()
        val cookies = cm.getCookie(url) ?: ""
        cookies.split(";").forEach { pair ->
            val name = pair.substringBefore("=").trim()
            if (name.isNotEmpty()) {
                cm.setCookie(url, "$name=; Max-Age=0; Path=/")
                cm.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=$host")
            }
        }
        cm.flush()
        wv.reload()
    }

    private fun setProgress(percent: Int) {
        val container = progressContainer ?: return
        val line = progressView ?: return
        val params = line.layoutParams
        params.width = if (percent >= 100) 0 else container.width * percent / 100
        line.layoutParams = params
    }

    private fun setLoading(isLoading: Boolean) {
        loading = isLoading
        reloadButton?.setImageResource(if (isLoading) R.drawable.ic_browser_close else R.drawable.ic_browser_refresh)
        reloadButton?.contentDescription = if (isLoading) label("stop", "Stop") else label("reload", "Reload")
    }

    private fun setHost(url: String?) {
        val uri = url?.let { Uri.parse(it) }
        val host = uri?.host
        if (uri == null || host.isNullOrEmpty()) {
            hostView?.text = ""
            return
        }
        hostView?.text = if (uri.scheme == "https") "🔒 $host" else "${label("notSecure", "Not secure")} · $host"
        if (titleView?.text.isNullOrEmpty()) titleView?.text = host
    }

    fun setStatus(state: String, filename: String, bookHash: String?) {
        mainHandler.removeCallbacks(hideBannerRunnable)
        val fallback = mapOf(
            "downloading" to "Downloading", "importing" to "Importing", "added" to "Added to library",
            "failed" to "Import failed", "unsupported" to "Not a supported book format",
        )
        bannerText?.text = "${label(state, fallback[state] ?: state)} · $filename"
        openBookHash = if (state == "added") bookHash else null
        bannerOpen?.visibility = if (openBookHash != null) View.VISIBLE else View.GONE
        banner?.visibility = View.VISIBLE
        if (state != "downloading" && state != "importing") {
            mainHandler.postDelayed(hideBannerRunnable, BANNER_HIDE_MS)
        }
    }

    // MARK: web view

    private fun configureWebView(act: Activity, wv: WebView) {
        val settings: WebSettings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.userAgentString = ClipUrlController.BROWSER_USER_AGENT
        settings.loadsImagesAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.setSupportMultipleWindows(true)
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        wv.setBackgroundColor(bg)

        // The CookieManager is app-wide and persistent, so a sign-in here
        // survives across browser sessions. Third-party cookies are required
        // by most SSO redirects.
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(wv, true)

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase() ?: return false
                if (scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" || scheme == "data") return false
                openExternal(act, request.url.toString())
                return true
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                setHost(url)
                backButton?.visibility = if (view.canGoBack()) View.VISIBLE else View.INVISIBLE
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                setLoading(true)
                setHost(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                setLoading(false)
                setProgress(100)
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                setProgress(newProgress)
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                titleView?.text = if (title.isNullOrBlank()) view.url?.let { Uri.parse(it).host } else title
            }

            // target=_blank / window.open: load the target in this WebView.
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                val temp = WebView(act)
                temp.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        view.loadUrl(request.url.toString())
                        mainHandler.post { temp.destroy() }
                        return true
                    }
                }
                transport.webView = temp
                resultMsg.sendToTarget()
                return true
            }
        }

        wv.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }
    }

    // MARK: downloads

    private fun startDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        val filename = sanitizeFilename(URLUtil.guessFileName(url, contentDisposition, mimeType))
        val dirPath = args.downloadDir
        if (dirPath.isNullOrBlank() || url.startsWith("blob:") || url.startsWith("data:")) {
            setStatus("failed", filename, null)
            onDownload(WebBrowserDownloadEvent(url, "", filename, false, "Unsupported download URL"))
            return
        }
        val dir = File(dirPath)
        dir.mkdirs()
        val dest = uniqueFile(dir, filename)
        setStatus("downloading", dest.name, null)
        val cookie = CookieManager.getInstance().getCookie(url)
        Thread {
            var error: String? = null
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 15_000
                conn.readTimeout = 60_000
                if (!userAgent.isNullOrEmpty()) conn.setRequestProperty("User-Agent", userAgent)
                if (!cookie.isNullOrEmpty()) conn.setRequestProperty("Cookie", cookie)
                val code = conn.responseCode
                if (code !in 200..299) throw IOException("HTTP $code")
                conn.inputStream.use { input -> FileOutputStream(dest).use { output -> input.copyTo(output) } }
            } catch (e: Exception) {
                Log.w(TAG, "download failed: $url", e)
                dest.delete()
                error = e.message ?: "Download failed"
            }
            val success = error == null
            mainHandler.post {
                if (!success) setStatus("failed", dest.name, null)
                onDownload(WebBrowserDownloadEvent(url, dest.absolutePath, dest.name, success, error))
            }
        }.start()
    }

    private fun sanitizeFilename(raw: String): String {
        val cleaned = raw.map { c ->
            if (c in "/\\:*?\"<>|" || c.code < 32) '_' else c
        }.joinToString("").trim().trim('.')
        return if (cleaned.isEmpty()) "download" else cleaned
    }

    // Atomically reserve the destination so two concurrent downloads of the
    // same filename can never share a path: createNewFile() succeeds for only
    // one caller, and the loser retries with the next suffix.
    private fun uniqueFile(dir: File, name: String): File {
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var n = 0
        while (true) {
            val candidate = if (n == 0) File(dir, name) else File(dir, "$stem ($n)$ext")
            try {
                if (candidate.createNewFile()) return candidate
            } catch (e: IOException) {
                Log.w(TAG, "reserve failed: ${candidate.name}", e)
            }
            n++
        }
    }

    // MARK: lifecycle

    private fun finish(hash: String?) {
        if (finished) return
        finished = true
        mainHandler.removeCallbacks(hideBannerRunnable)
        try {
            // Persist any session the page established so the next visit
            // is already signed in.
            CookieManager.getInstance().flush()
        } catch (e: Exception) {
            Log.w(TAG, "error flushing cookies", e)
        }
        try {
            webView?.stopLoading()
            webView?.webViewClient = WebViewClient()
            webView?.webChromeClient = null
            dialog?.dismiss()
            webView?.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "error tearing down browser", e)
        }
        dialog = null
        webView = null
        completion(hash)
    }

    private fun isLight(color: Int): Boolean =
        (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) > 153

    private fun dp(act: Activity, units: Int): Int =
        (units * act.resources.displayMetrics.density + 0.5f).toInt()

    /** Parse `#rrggbb` into an Android ARGB int; null on malformed input. */
    private fun parseHexColor(s: String?): Int? {
        if (s == null) return null
        return try {
            Color.parseColor(s.trim())
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
