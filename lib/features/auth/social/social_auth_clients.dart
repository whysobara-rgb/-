import '../../../core/config/app_config.dart';
import 'apple_auth_client.dart';
import 'google_auth_client.dart';
import 'kakao_auth_client.dart';
import 'naver_auth_client.dart';
import 'sandbox_social_client.dart';
import 'social_auth_client.dart';

/// 화면에 나올 수 있는 소셜 로그인 클라이언트(표시 순서대로).
///
/// 실제로 버튼이 나오려면 (1) 서버 `GET /auth/providers`가 그 제공자를
/// 돌려주고 (2) 이 빌드에 키가 있어 [SocialAuthClient.isAvailable]이 true여야 한다.
List<SocialAuthClient> defaultSocialClients() {
  if (AppConfig.socialSandbox) {
    return [for (final p in SocialProvider.values) SandboxSocialClient(p)];
  }
  return const [
    KakaoAuthClient(),
    NaverAuthClient(),
    GoogleAuthClient(),
    AppleAuthClient(),
  ];
}

/// 서버가 지원하고 이 빌드에서 쓸 수 있는 클라이언트만 남긴다.
List<SocialAuthClient> visibleSocialClients(
  List<SocialAuthClient> clients,
  Iterable<String> serverProviders,
) {
  final enabled = serverProviders.map((p) => p.toUpperCase()).toSet();
  return [
    for (final c in clients)
      if (c.isAvailable && enabled.contains(c.provider.code)) c,
  ];
}

/// 앱 시작 때 한 번. 키가 없는 SDK는 건너뛴다.
Future<void> initSocialSdks() => KakaoAuthClient.init();
