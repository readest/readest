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
    private lateinit var wv: WebView
    private var interceptVolumeKeysEnabled = false
    private var interceptBackKeyEnabled = false

    override fun onWebViewCreate(webView: WebView) {
        wv = webView
    }

    private val keyEventMap = mapOf(
        KeyEvent.KEYCODE_BACK to "Back",
        KeyEvent.KEYCODE_VOLUME_DOWN to "VolumeDown",
        KeyEvent.KEYCODE_VOLUME_UP to "VolumeUp"
    )

    override fun interceptVolumeKeys(enabled: Boolean) {
        Log.d("MainActivity", "Intercept volume keys: $enabled")
        interceptVolumeKeysEnabled = enabled
    }

    override fun interceptBackKey(enabled: Boolean) {
        Log.d("MainActivity", "Intercept back key: $enabled")
        interceptBackKeyEnabled = enabled
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val action = when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> "touchstart"
            MotionEvent.ACTION_UP -> "touchend"
            MotionEvent.ACTION_CANCEL -> "touchcancel"
            MotionEvent.ACTION_POINTER_DOWN -> "touchstart"
            MotionEvent.ACTION_POINTER_UP -> "touchend"
            else -> null
        }

        action?.let { eventType ->
            val pointerIndex = event.actionIndex
            val pointerId = event.getPointerId(pointerIndex)
            val x = event.getX(pointerIndex)
            val y = event.getY(pointerIndex)
            val pressure = event.getPressure(pointerIndex)

            wv.evaluateJavascript(
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
            val keyName = keyEventMap[keyCode]

            if (keyName != null) {
                val shouldIntercept = when (keyCode) {
                    KeyEvent.KEYCODE_BACK -> interceptBackKeyEnabled
                    KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN -> interceptVolumeKeysEnabled
                    else -> false
                }

                if (shouldIntercept) {
                    wv.evaluateJavascript(
                        """
                        try { window.onNativeKeyDown("$keyName", $keyCode); } catch (_) {}
                        """.trimIndent(),
                        null
                    )
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val keyName = keyEventMap[keyCode]
        if (keyName != null) {
            wv.evaluateJavascript(
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
                        wv.evaluateJavascript(
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
                        wv.evaluateJavascript(
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
                    handleSingleFile(intent)
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                if (intent.type != null) {
                    handleMultipleFiles(intent)
                }
            }
        }
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
