package com.readest.native_tts

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import java.io.File
import java.io.RandomAccessFile

// Reads bytes [start, start + length) of a file as if they were the whole
// file, so ExoPlayer can stream and seek a stored (uncompressed) audio entry
// in place inside an EPUB instead of the WebView copying it out first.
@UnstableApi
class FileWindowDataSource(
    private val file: File,
    private val start: Long,
    private val length: Long,
) : BaseDataSource(false) {
    private var input: RandomAccessFile? = null
    private var uri: Uri? = null
    private var remaining = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        if (dataSpec.position > length) {
            throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        }
        input = RandomAccessFile(file, "r").apply { seek(start + dataSpec.position) }
        val available = length - dataSpec.position
        remaining =
            if (dataSpec.length == C.LENGTH_UNSET.toLong()) available
            else minOf(dataSpec.length, available)
        opened = true
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, readLength: Int): Int {
        if (readLength == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val read = input!!.read(buffer, offset, minOf(remaining, readLength.toLong()).toInt())
        if (read == -1) return C.RESULT_END_OF_INPUT
        remaining -= read
        bytesTransferred(read)
        return read
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        uri = null
        try {
            input?.close()
        } finally {
            input = null
            if (opened) {
                opened = false
                transferEnded()
            }
        }
    }
}
