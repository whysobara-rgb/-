import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../../../core/config/app_config.dart';
import 'social_auth_client.dart';

/// 구글 로그인. 서버는 ID 토큰의 서명·iss·exp와 aud(GOOGLE_CLIENT_IDS)를 본다.
///
/// google_sign_in 7.x의 웹 구현은 앱이 만든 버튼으로 로그인할 수 없고
/// (구글이 그린 버튼만 가능) 이 화면 구성과 맞지 않아 웹에서는 숨긴다.
class GoogleAuthClient implements SocialAuthClient {
  const GoogleAuthClient();

  static Future<void>? _init;

  bool get _isIos => defaultTargetPlatform == TargetPlatform.iOS;

  @override
  SocialProvider get provider => SocialProvider.google;

  @override
  bool get isAvailable {
    if (kIsWeb) return false;
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => AppConfig.googleServerClientId.isNotEmpty,
      TargetPlatform.iOS => AppConfig.googleIosClientId.isNotEmpty,
      _ => false,
    };
  }

  Future<void> _ensureInitialized() =>
      _init ??= GoogleSignIn.instance.initialize(
        clientId: _isIos ? AppConfig.googleIosClientId : null,
        serverClientId: AppConfig.googleServerClientId.isEmpty
            ? null
            : AppConfig.googleServerClientId,
      );

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    try {
      await _ensureInitialized();
      if (!GoogleSignIn.instance.supportsAuthenticate()) {
        throw const SocialSignInFailed('이 기기에서는 구글 로그인을 쓸 수 없어요');
      }
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const SocialSignInFailed('구글 ID 토큰을 받지 못했어요');
      }
      return SocialCredential(token: idToken, nickname: account.displayName);
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled ||
          e.code == GoogleSignInExceptionCode.interrupted) {
        throw const SocialSignInCancelled();
      }
      throw SocialSignInFailed('구글 로그인에 실패했어요 (${e.code.name})');
    }
  }

  @override
  Future<void> signOut() async {
    if (!isAvailable || _init == null) return;
    try {
      await GoogleSignIn.instance.signOut();
    } catch (_) {}
  }
}
