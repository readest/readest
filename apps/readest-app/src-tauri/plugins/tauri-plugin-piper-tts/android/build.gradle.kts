plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.readest.piper_tts"
    compileSdk = 36

    defaultConfig {
        minSdk = 24 // sherpa-onnx's prebuilt Android libs target API 24+

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

    // sherpa-onnx's native libraries (libsherpa-onnx-jni.so + libonnxruntime.so,
    // arm64-v8a + armeabi-v7a) are already vendored here, extracted from
    // sherpa-onnx-v1.13.8-android.tar.bz2. To update to a newer sherpa-onnx
    // release, replace the .so files under src/main/jniLibs/<abi>/ with the
    // ones from that release's tarball (keep only libsherpa-onnx-jni.so +
    // libonnxruntime.so — libsherpa-onnx-c-api.so/libsherpa-onnx-cxx-api.so
    // are statically linked into the JNI lib and not needed).
    sourceSets["main"].jniLibs.srcDirs("src/main/jniLibs")
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation(kotlin("stdlib"))
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    implementation(project(":tauri-android"))
    // Voice packages and the shared espeak-ng-data are distributed as
    // .tar.bz2 by sherpa-onnx's GitHub releases; this is the only extra
    // dependency needed to unpack them on-device (bzip2 isn't supported by
    // java.util.zip). Resolves from Maven Central at build time — no
    // vendoring needed.
    implementation("org.apache.commons:commons-compress:1.26.1")
    // sherpa-onnx has no published Maven artifact for a bare Android library
    // module; the official integration is to vendor Tts.kt (from
    // k2-fsa/sherpa-onnx's sherpa-onnx/kotlin-api/ directory) directly into
    // src/main/java/com/k2fsa/sherpa/onnx/, alongside the native .so libs
    // under src/main/jniLibs/. Both are already vendored in this plugin.
}
