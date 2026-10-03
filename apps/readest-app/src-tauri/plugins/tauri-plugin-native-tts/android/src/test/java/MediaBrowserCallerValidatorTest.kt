package com.readest.native_tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MediaPlaybackService is exported so Android Auto can bind it, which means any
 * installed app can call onGetRoot. These cases pin who gets the real browse
 * tree; the risky part is the certificate data, not the logic, which is why the
 * pins are collected in shadow mode rather than guessed.
 */
class MediaBrowserCallerValidatorTest {
    private val ownUid = 10123

    private fun caller(
        packageName: String = "com.example.other",
        uid: Int = 10999,
        signatureSha256: Set<String> = setOf("aa11"),
        platformSigned: Boolean = false,
        holdsMediaContentControl: Boolean = false,
    ) = CallerIdentity(
        packageName = packageName,
        uid = uid,
        signatureSha256 = signatureSha256,
        platformSigned = platformSigned,
        holdsMediaContentControl = holdsMediaContentControl,
    )

    @Test
    fun ourOwnProcessIsAlwaysAllowed() {
        val access = MediaBrowserCallerValidator.evaluate(caller(uid = ownUid), ownUid)

        assertEquals(BrowseAccess.OWN_APP, access)
        assertTrue(access.allowed)
    }

    @Test
    fun platformSignedCallersAreAllowed() {
        val access = MediaBrowserCallerValidator.evaluate(
            caller(packageName = "com.android.systemui", platformSigned = true),
            ownUid,
        )

        assertEquals(BrowseAccess.PLATFORM_SIGNED, access)
    }

    @Test
    fun mediaContentControlHoldersAreAllowed() {
        val access = MediaBrowserCallerValidator.evaluate(
            caller(holdsMediaContentControl = true),
            ownUid,
        )

        assertEquals(BrowseAccess.MEDIA_CONTENT_CONTROL, access)
    }

    @Test
    fun anUnknownAppIsDenied() {
        val access = MediaBrowserCallerValidator.evaluate(caller(), ownUid)

        assertEquals(BrowseAccess.DENIED, access)
        assertFalse(access.allowed)
    }

    @Test
    fun aPinnedCertificateIsAllowed() {
        val access = MediaBrowserCallerValidator.evaluate(
            caller(packageName = "com.google.android.projection.gearhead", signatureSha256 = setOf("beef")),
            ownUid,
            mapOf("com.google.android.projection.gearhead" to setOf("beef")),
        )

        assertEquals(BrowseAccess.KNOWN_CERTIFICATE, access)
    }

    /**
     * The whole point of pinning: a sideloaded app can claim a package name on
     * a device where the real one is absent, but it cannot present its cert.
     */
    @Test
    fun aLookalikePackageWithTheWrongCertificateIsDenied() {
        val access = MediaBrowserCallerValidator.evaluate(
            caller(packageName = "com.google.android.projection.gearhead", signatureSha256 = setOf("dead")),
            ownUid,
            mapOf("com.google.android.projection.gearhead" to setOf("beef")),
        )

        assertEquals(BrowseAccess.DENIED, access)
    }

    /**
     * A caller must not slip through because we could not read its signatures
     * (the PackageManager lookup threw, or the pin table has no entry yet). An
     * `all {}` over an empty set is vacuously true, so both sides are checked.
     */
    @Test
    fun anEmptySignatureSetOrEmptyPinSetNeverPasses() {
        val noSignatures = MediaBrowserCallerValidator.evaluate(
            caller(packageName = "com.google.android.projection.gearhead", signatureSha256 = emptySet()),
            ownUid,
            mapOf("com.google.android.projection.gearhead" to setOf("beef")),
        )
        val noPins = MediaBrowserCallerValidator.evaluate(
            caller(packageName = "com.google.android.projection.gearhead", signatureSha256 = emptySet()),
            ownUid,
            emptyMap(),
        )

        assertEquals(BrowseAccess.DENIED, noSignatures)
        assertEquals(BrowseAccess.DENIED, noPins)
    }

    /**
     * A multiply-signed caller must match on EVERY certificate it presents, so
     * an extra unknown signer cannot ride along with a pinned one.
     */
    @Test
    fun oneMatchingCertificateAmongUnknownsIsDenied() {
        val access = MediaBrowserCallerValidator.evaluate(
            caller(
                packageName = "com.google.android.projection.gearhead",
                signatureSha256 = setOf("beef", "dead"),
            ),
            ownUid,
            mapOf("com.google.android.projection.gearhead" to setOf("beef")),
        )

        assertEquals(BrowseAccess.DENIED, access)
    }

    /**
     * Shipped state: no certificates are pinned yet, so a real Auto client only
     * gets in via the platform checks. This test is the tripwire for step 3 of
     * the procedure in MediaBrowserCallerValidator — when pins are added, it
     * should be updated deliberately, not silently.
     */
    @Test
    fun certificatesAreNotPinnedUntilObservedOnRealDevices() {
        assertTrue(MediaBrowserCallerValidator.TRUSTED_CERTIFICATES.isEmpty())
        assertTrue(
            "com.google.android.projection.gearhead" in
                MediaBrowserCallerValidator.EXPECTED_MEDIA_CLIENTS,
        )
    }
}
