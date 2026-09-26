package com.readest.native_bridge

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import java.lang.ref.WeakReference

/**
 * Configure screen for the bookshelf widget: a thin shim that opens the in-app
 * settings and holds the launcher's request until the user saves or cancels
 * there (see finishPending, called from move_task_to_back).
 *
 * The result goes out only as the app moves back, so the launcher never gets
 * stopped mid-placement (an NPE in completeTwoStageWidgetDrop in Nova). Home
 * clears this Activity first, so it cancels, as for any configure screen.
 */
class BookshelfWidgetConfigureActivity : Activity() {
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        pending = WeakReference(this)
        val deepLink =
            Intent(Intent.ACTION_VIEW, Uri.parse("readest://widget-settings/$appWidgetId"))
                .setPackage(packageName)
        try {
            startActivity(deepLink)
        } catch (e: ActivityNotFoundException) {
            // The widget can still be placed (with default settings).
            Log.w("BookshelfWidgetConfigure", "could not open in-app widget settings", e)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
            finish()
        }
    }

    // Back in the launcher's task (recents): nothing is waiting on us any more.
    override fun onRestart() {
        super.onRestart()
        finish()
    }

    override fun onDestroy() {
        if (pending?.get() === this) pending = null
        super.onDestroy()
    }

    companion object {
        private var pending: WeakReference<BookshelfWidgetConfigureActivity>? = null

        fun finishPending(saved: Boolean) {
            val activity = pending?.get() ?: return
            pending = null
            activity.runOnUiThread {
                if (saved) {
                    activity.setResult(
                        RESULT_OK,
                        Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, activity.appWidgetId),
                    )
                }
                activity.finish()
            }
        }
    }
}
