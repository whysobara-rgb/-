import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';
import '../../../core/config/app_config.dart';
import 'social_auth_client.dart';

/// 카카오 로그인. 카카오톡이 있으면 톡으로, 없으면 카카오계정 웹 로그인.
///
/// 카카오 Flutter SDK 2.x는 웹 로그인을 지원하지 않아 Android·iOS에서만 쓴다.
/// 서버는 access token의 app_id가 KAKAO_APP_ID와 같은지 확인한다.
class KakaoAuthClient implements SocialAuthClient {
  const KakaoAuthClient();

  static bool _initialized = false;

  /// 앱 시작 때 한 번. 키가 없으면 아무것도 하지 않는다.
  static Future<void> init() async {
    if (_initialized || AppConfig.kakaoNativeAppKey.isEmpty) return;
    await KakaoSdk.init(
      nativeAppKey: AppConfig.kakaoNativeAppKey,
      javaScriptAppKey: AppConfig.kakaoJsAppKey.isEmpty
          ? null
          : AppConfig.kakaoJsAppKey,
    );
    _initialized = true;
  }

  @override
  SocialProvider get provider => SocialProvider.kakao;

  @override
  bool get isAvailable =>
      !kIsWeb &&
      AppConfig.kakaoNativeAppKey.isNotEmpty &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    await init();
    try {
      final OAuthToken token;
      if (await isKakaoTalkInstalled()) {
        try {
          token = await UserApi.instance.loginWithKakaoTalk();
        } on PlatformException catch (e) {
          // 톡 화면에서 사용자가 취소. 그 밖의 톡 오류는 계정 로그인으로 넘긴다.
          if (e.code == 'CANCELED') throw const SocialSignInCancelled();
          return SocialCredential(
            token: (await UserApi.instance.loginWithKakaoAccount()).accessToken,
          );
        }
      } else {
        token = await UserApi.instance.loginWithKakaoAccount();
      }
      return SocialCredential(token: token.accessToken);
    } on SocialSignInCancelled {
      rethrow;
    } on KakaoClientException catch (e) {
      if (e.reason == ClientErrorCause.cancelled) {
        throw const SocialSignInCancelled();
      }
      throw SocialSignInFailed('카카오 로그인을 열지 못했어요 (${e.reason.name})');
    } on KakaoAuthException catch (e) {
      if (e.error == AuthErrorCause.accessDenied) {
        throw const SocialSignInCancelled();
      }
      throw SocialSignInFailed('카카오 로그인에 실패했어요 (${e.error.name})');
    } on PlatformException catch (e) {
      if (e.code == 'CANCELED') throw const SocialSignInCancelled();
      throw SocialSignInFailed('카카오 로그인에 실패했어요 (${e.code})');
    }
  }

  @override
  Future<void> signOut() async {
    if (!isAvailable || !_initialized) return;
    try {
      await UserApi.instance.logout();
    } catch (_) {}
  }
}
