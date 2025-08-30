package com.readest.native_bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.os.Build
import android.view.View
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowInsetsController
import android.graphics.Color
import android.webkit.WebView
import android.content.pm.ActivityInfo
import android.graphics.fonts.SystemFonts
import android.graphics.fonts.Font
import androidx.core.view.WindowCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import org.json.JSONArray
import java.io.*

@InvokeArg
class AuthRequestArgs {
  var authUrl: String? = null
}

@InvokeArg
class CopyURIRequestArgs {
  var uri: String? = null
  var dst: String? = null
}

@InvokeArg
class InstallPackageRequestArgs {
  var path: String? = null
}

@InvokeArg
class SetSystemUIVisibilityRequestArgs {
  var visible: Boolean? = false
  var darkMode: Boolean? = false
}

@InvokeArg
class InterceptKeysRequestArgs {
  var volumeKeys: Boolean? = null
  var backKey: Boolean? = null
}

@InvokeArg
class LockScreenOrientationRequestArgs {
  var orientation: String? = null
}

interface KeyDownInterceptor {
    fun interceptVolumeKeys(enabled: Boolean)
    fun interceptBackKey(enabled: Boolean)
}

@TauriPlugin
class NativeBridgePlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = NativeBridge()
    private var redirectScheme = "readest"
    private var redirectHost = "auth-callback"

    companion object {
        var pendingInvoke: Invoke? = null
    }

    override fun load(webView: WebView) {
        super.load(webView)
        handleIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        Log.e("NativeBridgePlugin", "Received intent: $uri")
        when {
          uri.scheme == "readest" && uri.host == "auth-callback" -> {
              val result = JSObject().apply {
                  put("redirectUrl", uri.toString())
              }
              pendingInvoke?.resolve(result)
              pendingInvoke = null
          }

          intent.action == Intent.ACTION_VIEW -> {
              try {
                activity.contentResolver.takePersistableUriPermission(
                      uri,
                      Intent.FLAG_GRANT_READ_URI_PERMISSION
                  )
              } catch (e: SecurityException) {
                Log.e("NativeBridgePlugin", "Failed to take persistable URI permission: ${e.message}")
              }
          }
        }
    }

    @Command
    fun auth_with_custom_tab(invoke: Invoke) {
        val args = invoke.parseArgs(AuthRequestArgs::class.java)
        val uri = Uri.parse(args.authUrl)

        val customTabsIntent = CustomTabsIntent.Builder().build()
        customTabsIntent.intent.flags = Intent.FLAG_ACTIVITY_NO_HISTORY

        Log.d("NativeBridgePlugin", "Launching OAuth URL: ${args.authUrl}")
        customTabsIntent.launchUrl(activity, uri)

        pendingInvoke = invoke
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

    @Command
    fun install_package(invoke: Invoke) {
        val args = invoke.parseArgs(InstallPackageRequestArgs::class.java)
        val ret = JSObject()
        try {
            val file = File(args.path ?: "")
            if (file.exists()) {
                val intent = Intent(Intent.ACTION_VIEW)
                val apkUri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                val packageManager = activity.packageManager
                val resolveInfos = packageManager.queryIntentActivities(intent, 0)
                for (resolveInfo in resolveInfos) {
                    val packageName = resolveInfo.activityInfo.packageName
                    activity.grantUriPermission(packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(intent)
                ret.put("success", true)
            } else {
                ret.put("success", false)
                ret.put("error", "File does not exist")
            }
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun set_system_ui_visibility(invoke: Invoke) {
        val args = invoke.parseArgs(SetSystemUIVisibilityRequestArgs::class.java)
        val visible = args.visible ?: false
        var isDarkMode = args.darkMode ?: false
        val ret = JSObject()
        try {
            val window = activity.window
            val decorView = window.decorView
            if (!visible) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    window.attributes.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                @Suppress("DEPRECATION")
                window.setDecorFitsSystemWindows(false)
                val controller = window.insetsController
                if (controller != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        val compatController = WindowCompat.getInsetsController(window, decorView)
                        compatController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    }

                    if (isDarkMode) {
                        controller.setSystemBarsAppearance(
                            0,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        )
                    } else {
                        controller.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        )
                    }
                    if (visible) {
                        controller.show(WindowInsets.Type.statusBars())
                        controller.hide(WindowInsets.Type.navigationBars())
                    } else {
                        controller.hide(WindowInsets.Type.systemBars())
                    }
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val compatController = WindowCompat.getInsetsController(window, decorView)
                compatController.let {
                    it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    if (!isDarkMode) {
                        it.isAppearanceLightStatusBars = true
                    } else {
                        it.isAppearanceLightStatusBars = false
                    }
                    if (visible) {
                        it.show(WindowInsetsCompat.Type.statusBars())
                        it.hide(WindowInsetsCompat.Type.navigationBars())
                    } else {
                        it.hide(WindowInsetsCompat.Type.systemBars())
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                decorView.systemUiVisibility = buildList {
                    add(View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
                    add(View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
                    add(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
                    add(View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
                    add(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

                    if (!visible) {
                        add(View.SYSTEM_UI_FLAG_FULLSCREEN)
                    }
                    if (visible && !isDarkMode) {
                        add(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                    }
                }.reduce { acc, flag -> acc or flag }
            }
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.TRANSPARENT
            ret.put("success", true)
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_status_bar_height(invoke: Invoke) {
        val ret = JSObject()
        try {
            val resourceId = activity.resources.getIdentifier("status_bar_height", "dimen", "android")
            val height = if (resourceId > 0) {
                activity.resources.getDimensionPixelSize(resourceId)
            } else {
                0
            }
            ret.put("height", height)
        } catch (e: Exception) {
            ret.put("height", -1)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_sys_fonts_list(invoke: Invoke) {
        val ret = JSObject()
        try {
            val fontList = mutableListOf<String>()
            val fontFileList = mutableListOf<String>()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val systemFonts = SystemFonts.getAvailableFonts()
                for (font in systemFonts) {
                    val file = font.getFile()?: continue
                    if (file.isFile && (file.name.endsWith(".ttf", true) || file.name.endsWith(".otf", true))) {
                        fontFileList.add(file.name)
                    }
                }
            } else {
                val fontDirs = listOf("/system/fonts", "/system/font", "/data/fonts")
                for (dirPath in fontDirs) {
                  val dir = File(dirPath)
                  if (dir.exists() && dir.isDirectory) {
                      dir.listFiles()?.forEach { file ->
                          if (file.isFile && (file.name.endsWith(".ttf", true) || file.name.endsWith(".otf", true))) {
                              fontFileList.add(file.name)
                          }
                      }
                  }
                }
            }
            for (fileFileName in fontFileList) {
                var fontName = fileFileName
                    .replace(Regex("\\.(ttf|otf)$", RegexOption.IGNORE_CASE), "")
                    .trim()
                fontList.add(fontName)
            }
            var fontDict = JSObject()
            for (fontName in fontList) {
                fontDict.put(fontName, fontName)
            }
            ret.put("fonts", fontDict)
        } catch (e: Exception) {
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun intercept_keys(invoke: Invoke) {
        val args = invoke.parseArgs(InterceptKeysRequestArgs::class.java)
        if (activity is KeyDownInterceptor) {
          when (args.backKey) {
              true -> (activity as KeyDownInterceptor).interceptBackKey(true)
              false -> (activity as KeyDownInterceptor).interceptBackKey(false)
              else -> {}
          }
          when (args.volumeKeys) {
              true -> (activity as KeyDownInterceptor).interceptVolumeKeys(true)
              false -> (activity as KeyDownInterceptor).interceptVolumeKeys(false)
              else -> {}
          }
        } else {
            Log.e("NativeBridgePlugin", "Activity does not implement KeyDownInterceptor")
        }
        invoke.resolve()
    }

    @Command
    fun lock_screen_orientation(invoke: Invoke) {
      val args = invoke.parseArgs(LockScreenOrientationRequestArgs::class.java)
      val orientation = args.orientation ?: "auto"
      when (orientation) {
          "portrait" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
          "landscape" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
          "auto" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER
          else -> {
              invoke.reject("Invalid orientation mode")
              return
          }
      }
      invoke.resolve()
    }

    @Command
    fun get_safe_area_insets(invoke: Invoke) {
        val ret = JSObject()
        try {
            val rootView = activity.findViewById<View>(android.R.id.content)
            val windowInsets = androidx.core.view.ViewCompat.getRootWindowInsets(rootView)

            if (windowInsets != null) {
                val insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
                )
                val density = activity.resources.displayMetrics.density
                ret.put("top", insets.top / density)
                ret.put("right", insets.right / density)
                ret.put("bottom", insets.bottom / density)
                ret.put("left", insets.left / density)
            } else {
                ret.put("top", 0)
                ret.put("right", 0)
                ret.put("bottom", 0)
                ret.put("left", 0)
            }
        } catch (e: Exception) {
            ret.put("error", e.message)
            ret.put("top", 0)
            ret.put("right", 0)
            ret.put("bottom", 0)
            ret.put("left", 0)
        }
        invoke.resolve(ret)
    }
}
