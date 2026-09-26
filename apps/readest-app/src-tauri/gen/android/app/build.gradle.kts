import java.util.Properties
import java.io.FileInputStream
import org.apache.tools.ant.taskdefs.condition.Os

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.bilingify.readest"
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    val keystoreProperties = Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
    }
    defaultConfig {
        // Plain-http LAN media servers (Audiobookshelf and friends) stream through
        // the webview audio element, which obeys this manifest flag; native plugin
        // HTTP already allows cleartext. Scoped alternative (custom-scheme stream
        // proxy) is tracked as a follow-up.
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        // Sentry DSN precedence: environment (CI secret / shell export) wins,
        // else the gitignored .env.local, else .env at the app root (../../../
        // from this module). Empty => Sentry auto-init no-ops.
        manifestPlaceholders["sentryDsn"] = System.getenv("SENTRY_DSN")?.takeIf { it.isNotBlank() }
            ?: listOf("../../../.env.local", "../../../.env")
                .map { rootProject.file(it) }
                .filter { it.exists() }
                .firstNotNullOfOrNull { f ->
                    f.readLines()
                        .map { it.trim() }
                        .firstOrNull { it.startsWith("SENTRY_DSN=") }
                        ?.substringAfter("=")?.trim()?.trim('"', '\'')?.takeIf { it.isNotEmpty() }
                }
            ?: ""
        applicationId = "com.bilingify.readest"
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        val storeFlavor = project.findProperty("storeFlavor")?.toString() ?: "foss"
        missingDimensionStrategy("store", storeFlavor)
        // Android Auto ships to the FOSS/GitHub builds only. Play's Auto
        // review rejected version code 11020 for inconsistent in-car audio and
        // blocked the entire release (#5038, #5235), so the Play build resolves
        // the car meta-data to an inert name: Auto ignores it and Play does not
        // put the submission through Auto review. Nothing else reads it.
        manifestPlaceholders["carAppMetaName"] = if (storeFlavor == "googleplay") {
            "com.bilingify.readest.androidauto.withheld"
        } else {
            "com.google.android.gms.car.application"
        }
    }
    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("signing") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["password"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("signing")
            }
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("signing")
            }
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// AGP's own strip step only drops the .debug_* sections, so the Rust library
// reached the APK carrying 22MB of symbol tables (.symtab + .strtab) — a
// quarter of the download. Strip those too, after AGP has run and on the copy
// it packages: `target/` keeps the unstripped library, which is what the
// release workflow uploads to Sentry so Rust panics still symbolicate.
//
// The NDK is located by hand because this module declares no `ndkVersion`, so
// `android.ndkDirectory` throws "NDK is not installed". The Tauri CLI sets
// NDK_HOME for the cargo linkers; the SDK scan covers a reused Gradle daemon
// that started without it in its environment.
val llvmStripExecutable = if (Os.isFamily(Os.FAMILY_WINDOWS)) "llvm-strip.exe" else "llvm-strip"

fun findLlvmStrip(): File {
    val ndkRoots = listOfNotNull(
        System.getenv("NDK_HOME"),
        System.getenv("ANDROID_NDK_HOME"),
        System.getenv("ANDROID_NDK_ROOT"),
    ).map { File(it) } +
        File(android.sdkDirectory, "ndk").listFiles().orEmpty().sortedDescending()
    return ndkRoots
        .flatMap { File(it, "toolchains/llvm/prebuilt").listFiles().orEmpty().toList() }
        .map { File(it, "bin/$llvmStripExecutable") }
        .firstOrNull { it.isFile }
        ?: throw GradleException("$llvmStripExecutable not found; looked in $ndkRoots")
}

tasks.configureEach {
    if (!name.startsWith("strip") || !name.endsWith("ReleaseDebugSymbols")) return@configureEach
    doLast {
        val llvmStrip = findLlvmStrip()
        outputs.files.asFileTree.matching { include("**/*.so") }.forEach { lib ->
            providers.exec {
                commandLine(llvmStrip.absolutePath, "--strip-all", lib.absolutePath)
            }.result.get().assertNormalExitValue()
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("io.sentry:sentry-android:8.47.0") {
        // androidx.lifecycle:lifecycle-common-java8 was merged into
        // lifecycle-common and is no longer published at 2.9.0+. The project
        // pins androidx.lifecycle to 2.10.0 (lifecycle-process above), which
        // version-aligns this Sentry transitive to a nonexistent 2.10.0 and
        // breaks dependency resolution. The Java8 lifecycle APIs Sentry uses now
        // live in lifecycle-common, pulled in transitively via lifecycle-process.
        exclude(group = "androidx.lifecycle", module = "lifecycle-common-java8")
    }
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
