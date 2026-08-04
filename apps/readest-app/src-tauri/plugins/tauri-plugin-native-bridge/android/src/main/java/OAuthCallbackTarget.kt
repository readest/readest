package com.readest.native_bridge

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

internal data class OAuthCallbackTarget(
    private val scheme: String,
    private val userInfo: String?,
    private val host: String?,
    private val port: Int,
    private val path: String,
) {
    fun matches(callbackUrl: String): Boolean = parse(callbackUrl) == this

    companion object {
        fun parse(url: String): OAuthCallbackTarget? {
            return try {
                val uri = URI(url)
                val scheme = uri.scheme ?: return null
                OAuthCallbackTarget(
                    scheme = scheme.lowercase(Locale.ROOT),
                    userInfo = uri.rawUserInfo,
                    host = uri.host?.lowercase(Locale.ROOT),
                    port = uri.port,
                    path = normalizeRootPath(uri.rawPath),
                )
            } catch (_: URISyntaxException) {
                null
            }
        }

        private fun normalizeRootPath(path: String?): String = when (path) {
            null, "", "/" -> ""
            else -> path
        }
    }
}
