import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import '../../../core/config/app_config.dart';
import 'social_auth_client.dart';

/// Sign in with Apple. 서버는 identity token의 서명·iss·exp와
/// aud(APPLE_CLIENT_IDS: iOS 번들 ID, Services ID)를 본다.
///
/// - iOS·macOS: 네이티브 시트. 키가 필요 없다(Xcode에서 capability만 켠다).
/// - Android·웹: Apple 웹 인증. APPLE_SERVICE_ID와 APPLE_REDIRECT_URI가
///   모두 있어야 한다. Android는 리디렉트 URI가 앱으로 되돌려 보내는 서버
///   엔드포인트를 따로 필요로 한다(docs/SOCIAL_LOGIN_SETUP.md).
class AppleAuthClient implements SocialAuthClient {
  const AppleAuthClient();

  bool get _native =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS);

  bool get _webFlow =>
      AppConfig.appleServiceId.isNotEmpty &&
      AppConfig.appleRedirectUri.isNotEmpty &&
      (kIsWeb || defaultTargetPlatform == TargetPlatform.android);

  @override
  SocialProvider get provider => SocialProvider.apple;

  @override
  bool get isAvailable => _native || _webFlow;

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: const [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
        webAuthenticationOptions: _native
            ? null
            : WebAuthenticationOptions(
                clientId: AppConfig.appleServiceId,
                redirectUri: Uri.parse(AppConfig.appleRedirectUri),
              ),
      );
      final token = credential.identityToken;
      if (token == null || token.isEmpty) {
        throw const SocialSignInFailed('Apple 인증 토큰을 받지 못했어요');
      }
      // 이름은 첫 인증 때만 온다. 한국식으로 성+이름.
      final name = [
        credential.familyName,
        credential.givenName,
      ].whereType<String>().join().trim();
      return SocialCredential(
        token: token,
        nickname: name.isEmpty ? null : name,
      );
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) {
        throw const SocialSignInCancelled();
      }
      throw SocialSignInFailed('Apple 로그인에 실패했어요 (${e.code.name})');
    } on SignInWithAppleException catch (e) {
      throw SocialSignInFailed('Apple 로그인을 쓸 수 없어요 ($e)');
    }
  }

  /// Apple은 앱이 끊을 세션이 없다.
  @override
  Future<void> signOut() async {}
}
