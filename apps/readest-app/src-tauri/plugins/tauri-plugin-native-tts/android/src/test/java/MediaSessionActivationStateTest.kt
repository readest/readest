package com.readest.native_tts

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaSessionActivationStateTest {
    @Before
    fun resetState() {
        MediaSessionActivationState.resetForTest()
    }

    @Test
    fun staleSessionCannotDeactivateOrOverwriteReplacement() {
        MediaSessionActivationState.requestActivation("old-session")
        MediaSessionActivationState.requestActivation("new-session")

        assertFalse(MediaSessionActivationState.requestDeactivation("old-session"))
        assertTrue(MediaSessionActivationState.isActivationDesired())
        assertFalse(MediaSessionActivationState.acceptsUpdate("old-session"))
        assertTrue(MediaSessionActivationState.acceptsUpdate("new-session"))

        assertTrue(MediaSessionActivationState.requestDeactivation("new-session"))
        assertFalse(MediaSessionActivationState.isActivationDesired())
    }
}
