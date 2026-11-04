package com.readest.native_bridge

import org.junit.Assert.assertEquals
import org.junit.Test

/** Host-JVM tests for the pure parts of [AnkiDroidLink] (#789). */
class AnkiDroidLinkTest {
    @Test
    fun fields_roundTripThroughTheSeparator() {
        val fields = listOf("a", "", "b<br>c")
        assertEquals(fields, AnkiDroidLink.splitFields(AnkiDroidLink.joinFields(fields)))
    }

    @Test
    fun fields_joinWithUnitSeparator() {
        assertEquals("front\u001fback", AnkiDroidLink.joinFields(listOf("front", "back")))
    }

    @Test
    fun deckSearch_matchesByDeckId() {
        assertEquals("did:1700000000000", AnkiDroidLink.deckSearch(1700000000000L))
    }
}
