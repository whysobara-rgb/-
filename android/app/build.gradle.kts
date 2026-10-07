// ✅ CRITICAL: Required imports for signing configuration
import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Flutter는 --dart-define 값을 Gradle 속성 "dart-defines"로 넘긴다
// (base64로 인코딩한 "KEY=VALUE"를 쉼표로 이은 값). 소셜 로그인 키를
// 매니페스트·리소스에 채우는 데 쓴다. 키가 없으면 해당 로그인은 앱에서 숨겨진다.
// 자세한 내용: docs/SOCIAL_LOGIN_SETUP.md
val dartDefines: Map<String, String> =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.filter { it.isNotBlank() }
        ?.mapNotNull { encoded ->
            val decoded = String(java.util.Base64.getDecoder().decode(encoded), Charsets.UTF_8)
            val i = decoded.indexOf('=')
            if (i <= 0) null else decoded.substring(0, i) to decoded.substring(i + 1)
        }
        ?.toMap()
        ?: emptyMap()

fun dartDefine(key: String): String = dartDefines[key] ?: ""

// ✅ Load signing configuration from key.properties
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
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

        // 카카오 로그인 리디렉트 스킴 kakao{네이티브 앱 키}. 키가 없으면 쓰이지 않는 값.
        val kakaoKey = dartDefine("KAKAO_NATIVE_APP_KEY")
        manifestPlaceholders["kakaoScheme"] =
            if (kakaoKey.isEmpty()) "kakaodisabled" else "kakao$kakaoKey"
        // 카드사 앱 결제 후 돌아올 앱 스킴(AppConfig.appScheme과 같은 값).
        manifestPlaceholders["appScheme"] = "gachigacha"

        // 네이버 로그인 SDK는 매니페스트 meta-data로 이 문자열을 읽는다.
        resValue("string", "naver_client_id", dartDefine("NAVER_CLIENT_ID"))
        resValue("string", "naver_client_secret", dartDefine("NAVER_CLIENT_SECRET"))
        resValue(
            "string",
            "naver_client_name",
            dartDefine("NAVER_CLIENT_NAME").ifEmpty { "GachiGacha" },
        )
    }

    buildFeatures {
        resValues = true
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
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

flutter {
    source = "../.."
}

