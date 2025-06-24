package com.bilingify.readest

import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.view.KeyEvent
import android.webkit.WebView
import android.util.Log
import android.graphics.Color
import android.app.ActivityManager
import android.content.res.Configuration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import com.readest.native_bridge.KeyDownInterceptor

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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            setTaskDescription(
                ActivityManager.TaskDescription(
                    getString(R.string.app_name),
                    null,
                    Color.TRANSPARENT
                )
            )
        }
    }
}
