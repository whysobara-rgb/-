// ✅ CRITICAL: Required imports for signing configuration
import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// ✅ Load signing configuration from key.properties
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// Opt-in configuration: ordinary debug/release builds keep their existing IDs.
// This avoids adding a flavor dimension to the existing CI build commands.
val stagingProperty = providers.gradleProperty("gachiStaging").orElse("false").get()
require(stagingProperty in listOf("true", "false")) { "gachiStaging must be true or false" }
val gachiStaging = stagingProperty == "true"
if (gachiStaging) {
    // Validate the defines actually consumed by Flutter, not a fallback URL.
    providers.exec {
        commandLine("python3", rootProject.file("../tool/staging/validate.py"), "defines")
        environment("DART_DEFINES", providers.gradleProperty("dart-defines").orElse("").get())
    }.result.get().assertNormalExitValue()
}

android {
    namespace = "com.gachavault.gacha"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.gachavault.gacha"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = keystoreProperties["storeFile"]?.let { file(it) }
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = if (gachiStaging) ".staging" else ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "app_name", "가치가차 테스트")
        }
        release {
            resValue("string", "app_name", "가치가차")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    if (gachiStaging) {
        buildTypes.getByName("debug").resValue("string", "app_name", "가치가차 Staging")
    }
}

androidComponents {
    beforeVariants(selector().withBuildType("release")) { variant ->
        // Staging uses debug only; do not consume the production release key.
        if (gachiStaging) variant.enable = false
    }
}

flutter {
    source = "../.."
}
