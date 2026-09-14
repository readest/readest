package com.readest.native_bridge

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewFeature
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ClipUrlTestActivity : Activity()

@RunWith(AndroidJUnit4::class)
class ClipUrlDocumentStartTest {
    class Probe {
        val values = LinkedBlockingQueue<String>()

        @JavascriptInterface
        fun record(value: String) {
            values.put(value)
        }
    }

    @Test
    fun fingerprintMaskRunsBeforePageScriptsAcrossNavigations() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = instrumentation.startActivitySync(
            Intent(instrumentation.targetContext, ClipUrlTestActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        val probe = Probe()
        lateinit var webView: WebView
        instrumentation.runOnMainSync {
            webView = WebView(activity)
            activity.setContentView(webView)
            val controller = ClipUrlController(activity, ClipUrlArgs().apply { interactive = true }) {}
            // Exercise the controller's actual WebView setup without presenting UI.
            val configure = ClipUrlController::class.java.getDeclaredMethod("configureWebView", WebView::class.java)
            configure.isAccessible = true
            configure.invoke(controller, webView)
            webView.addJavascriptInterface(probe, "CaptureProbe")
        }
        try {
            for (page in listOf("first", "after-login")) {
                instrumentation.runOnMainSync {
                    webView.loadDataWithBaseURL(
                        "https://readest.example/$page",
                        "<script>CaptureProbe.record(typeof navigator.webdriver + ':' + location.pathname)</script>",
                        "text/html", "UTF-8", null,
                    )
                }
                val observed = probe.values.poll(10, TimeUnit.SECONDS)
                assertTrue("Page script must execute", observed != null)
                assertEquals("undefined:/$page", observed)
            }
        } finally {
            instrumentation.runOnMainSync {
                webView.destroy()
                activity.finish()
            }
        }
    }
}
