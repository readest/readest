plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.readest.native_bridge"
    compileSdk = 36

    defaultConfig {
        minSdk = 21

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
    productFlavors {
        create("foss") {
            dimension = "store"
        }
        create("googleplay") {
            dimension = "store"
        }
    }
}

dependencies {
    "googleplayImplementation"("com.android.billingclient:billing-ktx:7.1.1")
    "googleplayImplementation"("com.google.android.gms:play-services-base:18.5.0")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.material:material:1.7.0")
    // EncryptedSharedPreferences (sync passphrase keychain backing).
    // Stays on the 1.1.0-alpha line because the stable 1.0.x release
    // doesn't support modern API targets cleanly; alpha is widely used
    // in production and the API is stable.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    implementation(project(":tauri-android"))
}
