package com.readest.native_tts

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

@UnstableApi
class FileWindowDataSourceTest {
    private val bytes = ByteArray(256) { it.toByte() }
    private val file = File.createTempFile("window", ".epub").apply {
        deleteOnExit()
        writeBytes(bytes)
    }

    // android.net.Uri is a stub in local unit tests; the source never reads it.
    private fun spec(position: Long, length: Long = C.LENGTH_UNSET.toLong()) =
        DataSpec(Uri.EMPTY, position, length)

    private fun readAll(source: FileWindowDataSource, spec: DataSpec): Pair<Long, ByteArray> {
        val opened = source.open(spec)
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(7)
        while (true) {
            val read = source.read(buffer, 0, buffer.size)
            if (read == C.RESULT_END_OF_INPUT) break
            out.write(buffer, 0, read)
        }
        source.close()
        return opened to out.toByteArray()
    }

    @Test
    fun readsOnlyTheWindow() {
        val (length, read) = readAll(FileWindowDataSource(file, 100, 50), spec(0))
        assertEquals(50L, length)
        assertArrayEquals(bytes.copyOfRange(100, 150), read)
    }

    @Test
    fun seeksRelativeToTheWindow() {
        val (length, read) = readAll(FileWindowDataSource(file, 100, 50), spec(30))
        assertEquals(20L, length)
        assertArrayEquals(bytes.copyOfRange(130, 150), read)
    }

    @Test
    fun boundsARangedReadByTheWindow() {
        val source = FileWindowDataSource(file, 100, 50)
        assertArrayEquals(bytes.copyOfRange(110, 120), readAll(source, spec(10, 10)).second)
        assertArrayEquals(bytes.copyOfRange(140, 150), readAll(source, spec(40, 100)).second)
    }
}
