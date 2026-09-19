package com.readest.native_tts

/**
 * Who is allowed to browse Readest's media tree.
 *
 * MediaPlaybackService is `android:exported="true"` because Android Auto can
 * only reach it that way, so *any* installed app can bind it and call
 * onGetRoot. The tree now carries library metadata (titles, authors, cover
 * URIs), which is reading history and must not be readable by whatever happens
 * to be on the device.
 *
 * The decision is a pure function over plain data so it can be unit-tested
 * without a device: the service reads the caller's identity from
 * PackageManager and hands it here.
 */
internal data class CallerIdentity(
    val packageName: String,
    val uid: Int,
    /** Lowercase hex SHA-256 of each signing certificate. */
    val signatureSha256: Set<String>,
    /** Signed with the platform key (SystemUI, the media stack). */
    val platformSigned: Boolean,
    /** Holds android.permission.MEDIA_CONTENT_CONTROL. */
    val holdsMediaContentControl: Boolean,
)

/**
 * Why a caller was allowed, or that it was not. The reason is logged in shadow
 * mode so the real grant path on real head units is observable before anything
 * is enforced.
 */
internal enum class BrowseAccess {
    OWN_APP,
    PLATFORM_SIGNED,
    MEDIA_CONTENT_CONTROL,
    KNOWN_CERTIFICATE,
    DENIED;

    val allowed: Boolean
        get() = this != DENIED
}

internal object MediaBrowserCallerValidator {
    /**
     * Packages we expect to browse. A package name alone is NOT trust: it only
     * rules out a sideloaded lookalike on a device where the real app is
     * already installed. It is used to label unknown callers in the shadow log
     * so the certificates below can be filled in from what real devices
     * actually present.
     */
    val EXPECTED_MEDIA_CLIENTS = setOf(
        "com.google.android.projection.gearhead", // Android Auto
        "com.google.android.carassistant", // Auto's assistant
        "com.google.android.googlequicksearchbox", // Google Assistant
        "com.google.android.wearable.app", // Wear OS
        "com.android.car.media", // Android Automotive's media app (observed)
        "com.android.systemui",
        "com.android.bluetooth",
    )

    /**
     * Certificate pins, keyed by package name, values lowercase hex SHA-256.
     *
     * Deliberately EMPTY. Hardcoding hashes copied from a sample or a blog post
     * is how an allowlist silently locks out a real head unit — OEM builds ship
     * clients we have not seen. The procedure is:
     *
     *   1. Ship with [ENFORCE_BROWSE_VALIDATION] false (shadow mode). Every
     *      caller is served as before; the verdict and certificate hashes are
     *      logged.
     *   2. Run a real Auto session (or the Desktop Head Unit) and read logcat
     *      for `browse caller` lines.
     *   3. Pin the certificates observed here, for the packages above.
     *   4. Flip [ENFORCE_BROWSE_VALIDATION] to true.
     *
     * Until step 3, callers still get in via [BrowseAccess.PLATFORM_SIGNED] or
     * [BrowseAccess.MEDIA_CONTENT_CONTROL], which cover the system media stack
     * on every device we have seen — but NOT necessarily gearhead, which is
     * exactly what step 2 is for.
     *
     * Observed so far (Android Automotive emulator, android-34-ext9 arm64):
     *   com.android.car.media -> PLATFORM_SIGNED
     * so AAOS is already admitted with no pins at all. The gearhead verdict on
     * phone projection is still unmeasured: the Desktop Head Unit links over
     * ADB but never took video focus on the API 35 emulator, so its browse
     * request never reached us. Read it off a real head unit, or a phone that
     * completes projection, before step 4.
     */
    val TRUSTED_CERTIFICATES: Map<String, Set<String>> = emptyMap()

    fun evaluate(
        caller: CallerIdentity,
        ownUid: Int,
        trustedCertificates: Map<String, Set<String>> = TRUSTED_CERTIFICATES,
    ): BrowseAccess {
        if (caller.uid == ownUid) return BrowseAccess.OWN_APP
        if (caller.platformSigned) return BrowseAccess.PLATFORM_SIGNED
        // The platform only grants this to system/privileged apps, and it is
        // exactly "may drive other apps' media sessions".
        if (caller.holdsMediaContentControl) return BrowseAccess.MEDIA_CONTENT_CONTROL
        val pinned = trustedCertificates[caller.packageName].orEmpty()
        // An unpinned package must never pass: an empty pin set would otherwise
        // make `all { it in pinned }` vacuously true for a caller that presents
        // no signatures at all.
        if (pinned.isNotEmpty() && caller.signatureSha256.isNotEmpty() &&
            caller.signatureSha256.all { it in pinned }
        ) {
            return BrowseAccess.KNOWN_CERTIFICATE
        }
        return BrowseAccess.DENIED
    }
}
