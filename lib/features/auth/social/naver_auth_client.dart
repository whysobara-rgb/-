import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_naver_login/flutter_naver_login.dart';
import 'package:flutter_naver_login/interface/types/naver_login_status.dart';
import '../../../core/config/app_config.dart';
import 'social_auth_client.dart';

/// 네이버 로그인(네이티브 SDK). Android·iOS 전용 플러그인이라 웹에서는 숨긴다.
///
/// 키는 네이티브 설정(strings.xml / Info.plist)에서 읽힌다. 앱은
/// NAVER_CLIENT_ID dart-define이 있을 때만 버튼을 보여준다.
class NaverAuthClient implements SocialAuthClient {
  const NaverAuthClient();

  @override
  SocialProvider get provider => SocialProvider.naver;

  @override
  bool get isAvailable =>
      !kIsWeb &&
      AppConfig.naverClientId.isNotEmpty &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    final result = await FlutterNaverLogin.logIn();
    switch (result.status) {
      case NaverLoginStatus.loggedIn:
        var token = result.accessToken?.accessToken ?? '';
        if (token.isEmpty) {
          token = (await FlutterNaverLogin.getCurrentAccessToken()).accessToken;
        }
        if (token.isEmpty) {
          throw const SocialSignInFailed('네이버 토큰을 받지 못했어요');
        }
        return SocialCredential(
          token: token,
          nickname: result.account?.nickname,
        );
      case NaverLoginStatus.loggedOut:
        throw const SocialSignInCancelled();
      case NaverLoginStatus.error:
        final message = result.errorMessage ?? '';
        if (message.toLowerCase().contains('cancel')) {
          throw const SocialSignInCancelled();
        }
        throw SocialSignInFailed(
          message.isEmpty ? '네이버 로그인에 실패했어요' : '네이버 로그인에 실패했어요 ($message)',
        );
    }
  }

  @override
  Future<void> signOut() async {
    if (!isAvailable) return;
    try {
      await FlutterNaverLogin.logOut();
    } catch (_) {}
  }
}
