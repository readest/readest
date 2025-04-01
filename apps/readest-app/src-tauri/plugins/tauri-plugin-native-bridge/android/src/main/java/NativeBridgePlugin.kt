package com.readest.native_bridge

import android.app.Activity
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.io.*

@InvokeArg
class SafariAuthRequestArgs {
  var authUrl: String? = null
}

@InvokeArg
class CopyURIRequestArgs {
  var uri: String? = null
  var dst: String? = null
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

    @Command
    fun copy_uri_to_path(invoke: Invoke) {
        val args = invoke.parseArgs(CopyURIRequestArgs::class.java)
        val ret = JSObject()
        try {
            val uri = Uri.parse(args.uri ?: "")
            val dst = File(args.dst ?: "")
            val inputStream = activity.contentResolver.openInputStream(uri)

            if (inputStream != null) {
                dst.outputStream().use { output ->
                    inputStream.use { input ->
                        input.copyTo(output)
                    }
                }
                ret.put("success", true)
            } else {
                ret.put("success", false)
                ret.put("error", "Failed to open input stream from URI")
            }
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }
}
