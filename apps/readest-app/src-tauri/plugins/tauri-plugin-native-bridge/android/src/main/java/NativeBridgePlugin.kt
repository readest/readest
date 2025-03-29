package com.readest.native_bridge

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

@InvokeArg
class SafariAuthRequestArgs {
  var authUrl: String? = null
}

@TauriPlugin
class NativeBridgePlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = NativeBridge()

    @Command
    fun auth_with_safari(invoke: Invoke) {
        val args = invoke.parseArgs(SafariAuthRequestArgs::class.java)

        val ret = JSObject()
        ret.put("redirectUrl", implementation.auth_with_safari(args.authUrl ?: ""))
        invoke.resolve(ret)
    }
}
