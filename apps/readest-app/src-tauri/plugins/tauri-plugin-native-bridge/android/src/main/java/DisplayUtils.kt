package com.readest.native_bridge

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.button.MaterialButton

/** Sets the header's bottom padding (a margin can't be changed at runtime before Android 12):
 * 4dp at the default size, growing 0.5dp per extra sp so the gap keeps up with the text. */
fun setHeaderGap(context: Context, views: android.widget.RemoteViews, viewId: Int, headerSize: Int) {
    views.setViewPadding(viewId, 0, 0, 0, dp(context, Math.round(4 + (headerSize - DEFAULT_HEADER_SIZE) * 0.5f)))
}

/** dp to px, rounded. */
fun dp(context: Context, units: Int): Int =
    (units * context.resources.displayMetrics.density + 0.5f).toInt()

/** A flat (borderless) MaterialButton shrunk to content - the default TextButton
 * spec sizing (min width, top/bottom insets) is made for buttons with real
 * label text, and looks oversized for the single-glyph/icon-only buttons here. */
fun flatButton(context: Context) =
    MaterialButton(context, null, android.R.attr.borderlessButtonStyle).apply {
        setMinWidth(0)
        setMinimumWidth(0)
        setInsetTop(0)
        setInsetBottom(0)
    }

// Text size range (sp) for the widgets' configurable header and font size.
const val DEFAULT_TEXT_SIZE = 16
const val DEFAULT_HEADER_SIZE = 14
const val MIN_TEXT_SIZE = 12
const val MAX_TEXT_SIZE = 32

/** A "label  -  n  +" row editing value[0] within min..max. */
fun numberStepper(context: Context, label: String, value: IntArray, min: Int, max: Int): View {
    val count = TextView(context).apply {
        text = value[0].toString()
        gravity = Gravity.CENTER
        minEms = 2
    }
    fun button(sign: String, delta: Int) =
        flatButton(context).apply {
            text = sign
            setPadding(dp(context, 12), 0, dp(context, 12), 0)
            setOnClickListener {
                value[0] = (value[0] + delta).coerceIn(min, max)
                count.text = value[0].toString()
            }
        }
    return LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(
            TextView(context).apply { text = label },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        addView(button("−", -1))
        addView(count)
        addView(button("+", 1))
    }
}
