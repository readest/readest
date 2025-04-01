package com.bilingify.readest

import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.activity.enableEdgeToEdge
import app.tauri.plugin.JSObject
import com.readest.native_bridge.NativeBridgePlugin

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
	      
        hideSystemUI()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)

        val uri = intent.data ?: return
        if (uri.scheme == "readest" && uri.host == "auth-callback") {
            val result = JSObject().apply {
                put("redirectUrl", uri.toString())
            }

            NativeBridgePlugin.pendingInvoke?.resolve(result)
            NativeBridgePlugin.pendingInvoke = null
        }
  }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.decorView.windowInsetsController?.let { controller ->
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            )
        }
    }
}
