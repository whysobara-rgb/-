/// 체험판(데모) 빌드 설정.
///
/// `--dart-define=DEMO_MODE=true`로 빌드하면 앱이 서버 대신 브라우저 안의
/// [DemoBackend](backend/demo_backend.dart)와 이야기한다. 플래그가 꺼진
/// 빌드에서는 [enabled]가 상수 false라, 이 값으로 감싼 코드와 `lib/demo/`는
/// 컴파일 단계에서 빠진다.
class DemoConfig {
  DemoConfig._();

  static const bool enabled = bool.fromEnvironment('DEMO_MODE');

  /// 브라우저 탭 제목.
  static const String appTitle = '가치가차 체험판';

  /// 로그인 화면에 미리 채워 두는 체험 계정.
  static const String defaultEmail = 'demo@gachigacha.app';
  static const String defaultPassword = 'demo1234';
  static const String defaultNickname = '체험유저';

  /// 체험 계정이 처음 가진 GP.
  static const int defaultBalance = 200000;

  /// 처음 열 때 한 번 보여주는 안내.
  static const String noticeText =
      '가상 GP로 체험하는 데모예요. 확률과 상품 구성은 실제 서비스와 같고, '
      '결제·배송은 실제로 일어나지 않아요.';

  /// 배송 시뮬레이션이 쓰는 택배사 이름. 실제 택배사로 보이지 않게 한다.
  static const String trackingCompany = '체험판 택배';

  /// 카탈로그 스냅샷(실제 서버 응답).
  static const String catalogAsset = 'assets/demo/catalog.json';
}
