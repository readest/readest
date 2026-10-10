plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.readest.native_bridge"
    compileSdk = 36

    defaultConfig {
        minSdk = 21
        targetSdk = 36 // Keep the instrumented test APK aligned with the app.

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }

    flavorDimensions += "store"
    flavorDimensions += "pen"
    productFlavors {
        create("foss") {
            dimension = "store"
        }
        create("googleplay") {
            dimension = "store"
        }
        // Handwriting (issue #3673): default flavor, no vendor SDK, no extra
        // Maven repository. Ships in every normal Readest build.
        create("genericPen") {
            dimension = "pen"
        }
        // Opt-in flavor for BOOX low-latency raw drawing. Pulls the BOOX
        // Maven repository and the onyxsdk-pen artifact below — see
        // android/README-pen.md for why this can't be the default and how
        // to build it. Only android/src/booxPen/** is compiled in; nothing
        // else in the app depends on this flavor existing.
        create("booxPen") {
            dimension = "pen"
        }
    }
}

repositories {
    // Only reached when the booxPen flavor is actually built (Gradle only
    // resolves dependencies for the flavors it's asked to build), so a
    // normal genericPen build never talks to this host.
    maven { url = uri("https://repo.boox.com/repository/maven-public/") }
}

dependencies {
    // See android/README-pen.md: Onyx distributes onyxsdk-pen under Apache
    // 2.0 from their own Maven host, not Maven Central, and its transitive
    // dependencies haven't been audited for this repo. Gated behind the
    // booxPen flavor so default/FOSS builds never fetch it.
    "booxPenImplementation"("com.onyx.android.sdk:onyxsdk-pen:1.4.11")
    "googleplayImplementation"("com.android.billingclient:billing:9.1.0")
    "googleplayImplementation"("com.google.android.gms:play-services-base:18.5.0")
    "googleplayImplementation"("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.6.4")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.android.material:material:1.7.0")
    // EncryptedSharedPreferences (sync passphrase keychain backing).
    // Stays on the 1.1.0-alpha line because the stable 1.0.x release
    // doesn't support modern API targets cleanly; alpha is widely used
    // in production and the API is stable.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.media:media:1.7.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    implementation(project(":tauri-android"))
}
