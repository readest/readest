package com.readest.native_bridge

import android.app.Activity

/**
 * `genericPen` flavor build: no BOOX Pen SDK on the classpath. Readest still
 * gets handwriting via the generic browser pointer-event backend in JS; only
 * BOOX low-latency raw drawing is unavailable.
 */
object PenInputControllerFactory {
    fun create(activity: Activity): PenInputController = NoOpPenInputController
}
