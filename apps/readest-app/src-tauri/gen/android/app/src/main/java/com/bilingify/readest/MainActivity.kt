package com.bilingify.readest

import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.WebView
import android.net.Uri
import android.util.Log
import android.content.Intent
import android.graphics.Color
import android.app.ActivityManager
import android.content.res.Configuration
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import com.readest.native_bridge.KeyDownInterceptor
import com.readest.native_bridge.NativeBridgePlugin

class MainActivity : TauriActivity(), KeyDownInterceptor {
    private var wv: WebView? = null
    private var interceptVolumeKeysEnabled = false
    private var interceptBackKeyEnabled = false
    private var interceptPageTurnerKeysEnabled = false
    private var keyLearnModeEnabled = false
    // touchmove fires continuously; throttle its dispatch to ~10/s since each one
    // is an evaluateJavascript round-trip into the WebView.
    private val touchMoveThrottleMs = 100L
    private var lastTouchMoveTime = 0L
    // #3297: on Android 14+ the window can gain focus before the WebView has
    // loaded/painted its first frame, leaving a blank screen. Force a single
    // repaint as soon as both the window has focus and the WebView exists —
    // whichever happens last — so the compositor draws the initial frame.
    private var hasWindowFocus = false
    private var didInitialInvalidate = false

    override fun onWebViewCreate(webView: WebView) {
        wv = webView
        ensureInitialPaint()
    }

    private fun ensureInitialPaint() {
        val webView = wv ?: return
        if (didInitialInvalidate || !hasWindowFocus) return
        didInitialInvalidate = true
        webView.post { webView.invalidate() }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hasWindowFocus = true
            ensureInitialPaint()
        }
    }

    private val keyEventMap = mapOf(
        KeyEvent.KEYCODE_BACK to "Back",
        KeyEvent.KEYCODE_VOLUME_DOWN to "VolumeDown",
        KeyEvent.KEYCODE_VOLUME_UP to "VolumeUp"
    )

    private val mediaKeyMap = mapOf(
        KeyEvent.KEYCODE_MEDIA_NEXT to "MediaNext",
        KeyEvent.KEYCODE_MEDIA_PREVIOUS to "MediaPrevious",
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "MediaPlayPause",
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "MediaFastForward",
        KeyEvent.KEYCODE_MEDIA_REWIND to "MediaRewind"
    )

    private fun keyNameFor(keyCode: Int): String =
        keyEventMap[keyCode] ?: mediaKeyMap[keyCode] ?: "Keycode$keyCode"

    private fun forwardKeyToWebView(keyName: String, keyCode: Int) {
        wv?.evaluateJavascript(
            """try { window.onNativeKeyDown("$keyName", $keyCode); } catch (_) {}""",
            null
        )
    }

    override fun interceptVolumeKeys(enabled: Boolean) {
        Log.d("MainActivity", "Intercept volume keys: $enabled")
        interceptVolumeKeysEnabled = enabled
    }

    override fun interceptBackKey(enabled: Boolean) {
        Log.d("MainActivity", "Intercept back key: $enabled")
        interceptBackKeyEnabled = enabled
    }

    override fun interceptPageTurnerKeys(enabled: Boolean) {
        Log.d("MainActivity", "Intercept page turner keys: $enabled")
        interceptPageTurnerKeysEnabled = enabled
    }

    override fun setKeyLearnMode(enabled: Boolean) {
        Log.d("MainActivity", "Key learn mode: $enabled")
        keyLearnModeEnabled = enabled
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val action = when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> "touchstart"
            MotionEvent.ACTION_UP -> "touchend"
            MotionEvent.ACTION_CANCEL -> "touchcancel"
            MotionEvent.ACTION_POINTER_DOWN -> "touchstart"
            MotionEvent.ACTION_POINTER_UP -> "touchend"
            MotionEvent.ACTION_MOVE -> "touchmove"
            else -> null
        }

        // touchmove fires continuously; throttle its dispatch to ~10/s (each one
        // is an evaluateJavascript round-trip). down/up/cancel always go through.
        val throttledMove = action == "touchmove" &&
            event.eventTime - lastTouchMoveTime < touchMoveThrottleMs
        if (action == "touchmove" && !throttledMove) {
            lastTouchMoveTime = event.eventTime
        }

        action?.takeIf { !throttledMove }?.let { eventType ->
            val pointerIndex = event.actionIndex
            val pointerId = event.getPointerId(pointerIndex)
            val x = event.getX(pointerIndex)
            val y = event.getY(pointerIndex)
            val pressure = event.getPressure(pointerIndex)

            wv?.evaluateJavascript(
                """
                try {
                    if (window.onNativeTouch) {
                        window.onNativeTouch({
                            type: "$eventType",
                            pointerId: $pointerId,
                            x: $x,
                            y: $y,
                            pressure: $pressure,
                            pointerCount: ${event.pointerCount},
                            timestamp: ${event.eventTime}
                        });
                    }
                } catch (err) {
                    console.error('Native touch error:', err);
                }
                """.trimIndent(),
                null
            )
        }

        return super.dispatchTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val keyCode = event.keyCode

            // Learn mode: forward and consume every key so the settings UI
            // can capture whatever the remote sends.
            if (keyLearnModeEnabled && keyCode != KeyEvent.KEYCODE_BACK) {
                forwardKeyToWebView(keyNameFor(keyCode), keyCode)
                return true
            }

            // Hardware page turner: intercept media keys when enabled.
            if (interceptPageTurnerKeysEnabled && mediaKeyMap.containsKey(keyCode)) {
                forwardKeyToWebView(mediaKeyMap[keyCode]!!, keyCode)
                return true
            }

            val keyName = keyEventMap[keyCode]
            if (keyName != null) {
                val shouldIntercept = when (keyCode) {
                    KeyEvent.KEYCODE_BACK -> interceptBackKeyEnabled
                    KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN ->
                        interceptVolumeKeysEnabled
                    else -> false
                }

                if (shouldIntercept) {
                    forwardKeyToWebView(keyName, keyCode)
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val keyName = keyEventMap[keyCode]
        if (keyName != null) {
            wv?.evaluateJavascript(
                """
                try {
                    window.onNativeKeyDown("$keyName", $keyCode)
                } catch (err) {
                    false
                }
                """.trimIndent()
            ) { result ->
              run {
                if (result.equals("true", ignoreCase = true)) {
                  Log.d("Key Event", "Key event $keyName intercepted")
                }
              }
            }
            return when (keyCode) {
              KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN -> {
                  if (interceptVolumeKeysEnabled) {
                      true
                  } else {
                      super.onKeyDown(keyCode, event)
                  }
              }
              KeyEvent.KEYCODE_BACK -> {
                  if (interceptBackKeyEnabled) {
                      true
                  } else {
                      super.onKeyDown(keyCode, event)
                  }
              }
              else -> super.onKeyDown(keyCode, event)
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        handleIncomingIntent(intent)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            setTaskDescription(
                ActivityManager.TaskDescription(
                    getString(R.string.app_name),
                    null,
                    Color.TRANSPARENT
                )
            )
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                OnBackInvokedCallback {
                    Log.d("MainActivity", "Back invoked callback triggered ${interceptBackKeyEnabled}")
                    if (interceptBackKeyEnabled) {
                        Log.d("MainActivity", "Back intercepted (OnBackInvokedCallback)")
                        wv?.evaluateJavascript(
                            """window.onNativeKeyDown("Back", ${KeyEvent.KEYCODE_BACK});""",
                            null
                        )
                    } else {
                        finish()
                    }
                }
            )
        }

        onBackPressedDispatcher.addCallback(this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (interceptBackKeyEnabled) {
                        Log.d("MainActivity", "Back intercepted (OnBackPressedDispatcher)")
                        wv?.evaluateJavascript(
                            """window.onNativeKeyDown("Back", ${KeyEvent.KEYCODE_BACK});""",
                            null
                        )
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        NativeBridgePlugin.getInstance()?.handleActivityResult(requestCode, resultCode, data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent?.let { handleIncomingIntent(it) }
    }

    private fun handleIncomingIntent(intent: Intent) {
        when (intent.action) {
            Intent.ACTION_SEND -> {
                if (intent.type != null) {
                    // Browsers share article URLs as ACTION_SEND with
                    // type "text/plain" and the URL in EXTRA_TEXT. File
                    // shares (epub, pdf, etc.) put a content:// URI in
                    // EXTRA_STREAM. Try text first; on a miss fall back
                    // to the file path so the existing behaviour is
                    // preserved.
                    if (!handleSharedText(intent)) {
                        handleSingleFile(intent)
                    }
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                if (intent.type != null) {
                    handleMultipleFiles(intent)
                }
            }
        }
    }

    /**
     * Read the first http(s) URL out of `EXTRA_TEXT` and emit it on the
     * existing `shared-intent` event so the JS layer can clip it through
     * the same path that handles file shares.
     *
     * Returns true when a URL was found and dispatched; false when there
     * was no usable URL so the caller can try the file-share path.
     */
    private fun handleSharedText(intent: Intent): Boolean {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim() ?: return false
        // Browsers usually share just the URL, but some prepend a page
        // title or a tracker preamble. Pick the first http(s) token.
        val url = text.split(Regex("\\s+"))
            .firstOrNull { it.startsWith("http://") || it.startsWith("https://") }
            ?: return false
        val payload = JSObject().apply {
            val urls = JSArray()
            urls.put(url)
            put("urls", urls)
        }
        NativeBridgePlugin.getInstance()?.triggerEvent("shared-intent", payload)
        return true
    }

    private fun handleSingleFile(intent: Intent) {
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        uri?.let { fileUri ->
            val payload = JSObject().apply {
                var urls = JSArray()
                urls.put(fileUri.toString())
                put("urls", urls)
            }
            NativeBridgePlugin.getInstance()?.triggerEvent("shared-intent", payload)
        }
    }

    private fun handleMultipleFiles(intent: Intent) {
        val uris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        uris?.let { fileUris ->
            val payload = JSObject().apply {
                var urls = JSArray()
                fileUris.forEach { urls.put(it.toString()) }
                put("urls", urls)
            }
            NativeBridgePlugin.getInstance()?.triggerEvent("shared-intent", payload)
        }
    }
}
