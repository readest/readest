package com.readest.native_tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ColdEpubTextTest {
    @Test
    fun readsSpineTextFromSavedCfiSection() {
        val epub = createEpub()
        try {
            val speech = ColdEpubText.read(epub, "epubcfi(/6/4!/4/2/1:0)")

            assertEquals(1, speech.startSection)
            assertEquals(
                listOf("Chapter Two", "Second section text."),
                speech.segments.map { it.text },
            )
            assertTrue(speech.segments.all { it.sectionIndex == 1 })
            assertEquals("epubcfi(/6/4!/4/2/1:0)", speech.segments.first().cfi)
            assertEquals("epubcfi(/6/4!/4/4/1:0)", speech.segments.last().cfi)
        } finally {
            epub.delete()
        }
    }

    @Test
    fun resumesAtSavedTextOffsetInsideSpineSection() {
        val epub = createEpub()
        try {
            val speech = ColdEpubText.read(epub, "epubcfi(/6/4!/4/4/1:7)")

            assertEquals(1, speech.startSection)
            assertEquals(listOf("section text."), speech.segments.map { it.text })
        } finally {
            epub.delete()
        }
    }

    @Test
    fun resumesAtStartOfSavedRangeInsideSpineSection() {
        val epub = createEpub()
        try {
            val speech = ColdEpubText.read(epub, "epubcfi(/6/4!/4/4,/1:7,/1:14)")

            assertEquals(listOf("section text."), speech.segments.map { it.text })
        } finally {
            epub.delete()
        }
    }

    @Test
    fun boundsLongSpeechChunksForAndroidTts() {
        val epub = createEpub("A".repeat(5_100))
        try {
            val speech = ColdEpubText.read(epub, null)
            assertTrue(speech.segments.all { it.text.length <= 2_500 })
        } finally {
            epub.delete()
        }
    }

    @Test
    fun resumesAtEachParagraphRatherThanTheOriginalSavedPosition() {
        val epub = createEpub()
        try {
            val speech = ColdEpubText.read(epub, "epubcfi(/6/4!/4/2/1:0)")
            val paragraph = speech.segments.last()
            assertEquals(paragraph.text, ColdEpubText.read(epub, paragraph.cfi).segments.first().text)
        } finally {
            epub.delete()
        }
    }

    @Test
    fun resumesAtEachLongChunkAfterWhitespaceNormalizationAndInlineMarkup() {
        val epub = createEpub("  <em>Intro.</em>  " + "word   ".repeat(900) + "<![CDATA[Ending.]]>")
        try {
            val chunks = ColdEpubText.read(epub, null).segments.filter { it.sectionIndex == 0 }.drop(1)
            assertTrue(chunks.size > 1)
            for (chunk in chunks) {
                assertEquals(chunk.text, ColdEpubText.read(epub, chunk.cfi).segments.first().text)
            }
        } finally {
            epub.delete()
        }
    }

    @Test
    fun resumesAtOffsetsInsideAnUnbrokenTextNode() {
        val epub = createEpub("A".repeat(2500) + "B".repeat(2500) + "C".repeat(100))
        try {
            val chunks = ColdEpubText.read(epub, null).segments.filter { it.sectionIndex == 0 }.drop(1)
            assertEquals(3, chunks.size)
            for (chunk in chunks) {
                assertEquals(chunk.text, ColdEpubText.read(epub, chunk.cfi).segments.first().text)
            }
        } finally {
            epub.delete()
        }
    }

    @Test
    fun preservesCfiOffsetsAcrossAdjacentTextAndCdataNodes() {
        val epub = createEpub("Before.\n<![CDATA[Middle.\n]]>After.")
        try {
            val chunks = ColdEpubText.read(epub, null).segments.filter { it.sectionIndex == 0 }.drop(1)
            assertEquals(listOf("Before.", "Middle.", "After."), chunks.map { it.text })
            assertEquals("epubcfi(/6/2!/2/4/1:8)", chunks[1].cfi)
            assertEquals("epubcfi(/6/2!/2/4/1:16)", chunks[2].cfi)
            for (chunk in chunks) {
                assertEquals(chunk.text, ColdEpubText.read(epub, chunk.cfi).segments.first().text)
            }
        } finally {
            epub.delete()
        }
    }

    private fun createEpub(firstText: String = "First section text."): File {
        val file = File.createTempFile("cold-epub-", ".epub")
        ZipOutputStream(file.outputStream()).use { zip ->
            fun add(path: String, content: String) {
                zip.putNextEntry(ZipEntry(path))
                zip.write(content.toByteArray())
                zip.closeEntry()
            }
            add(
                "META-INF/container.xml",
                """<?xml version="1.0"?><!DOCTYPE container SYSTEM "https://example.invalid/container.dtd"><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""",
            )
            add(
                "OEBPS/content.opf",
                """<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>""",
            )
            add(
                "OEBPS/one.xhtml",
                """<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>$firstText</p></body></html>""",
            )
            add(
                "OEBPS/two.xhtml",
                """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><h1>Chapter Two</h1><p>Second section text.</p></body></html>""",
            )
        }
        return file
    }
}
