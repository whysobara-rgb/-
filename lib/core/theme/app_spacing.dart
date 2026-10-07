import 'package:flutter/widgets.dart';

/// 간격·모서리·그림자·모션 토큰. 화면 코드에서 숫자를 직접 쓰지 않고
/// 여기 이름만 쓴다(컬러는 app_colors.dart, 글자는 app_typography.dart).

/// 4/8 그리드 간격. 화면 좌우 여백은 [gutter](20) 하나로 통일한다.
class Space {
  Space._();

  static const double x1 = 4;
  static const double x2 = 8;
  static const double x3 = 12;
  static const double x4 = 16;
  static const double x5 = 20;
  static const double x6 = 24;
  static const double x8 = 32;
  static const double x10 = 40;
  static const double x12 = 48;

  /// 페이지 좌우 여백.
  static const double gutter = 20;

  /// 홈·상세에서 섹션과 섹션 사이.
  static const double section = 36;

  static const EdgeInsets page = EdgeInsets.symmetric(horizontal: gutter);
}

/// 모서리 반경. 카드는 넉넉히 둥글게, 칩은 작게.
class Radii {
  Radii._();

  /// 칩·배지.
  static const double sm = 6;

  /// 썸네일·버튼·입력창.
  static const double md = 12;

  /// 카드·시트·다이얼로그.
  static const double lg = 18;

  /// 배너·히어로 카드.
  static const double xl = 24;

  static const BorderRadius chip = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius thumb = BorderRadius.all(Radius.circular(md));
  static const BorderRadius button = BorderRadius.all(Radius.circular(14));
  static const BorderRadius card = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius hero = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius pill = BorderRadius.all(Radius.circular(999));
  static const BorderRadius sheet = BorderRadius.vertical(
    top: Radius.circular(xl),
  );
}

/// 그림자. 밝은 테마의 깊이는 여러 겹의 아주 옅은 그림자로 만든다
/// (한 겹의 진한 그림자는 싸 보인다). 색은 순흑이 아니라 남색 기운의 잉크.
class Shadows {
  Shadows._();

  static const Color _ink = Color(0xFF101828);

  /// 리스트·그리드 카드: 바닥에 닿은 듯한 짧은 그림자 + 넓고 옅은 그림자.
  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x0A101828), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F101828), blurRadius: 16, offset: Offset(0, 6)),
  ];

  /// 상품 사진·패키지처럼 '물건'이 떠 있는 느낌. 세 겹.
  static const List<BoxShadow> product = [
    BoxShadow(color: Color(0x0D101828), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x12101828), blurRadius: 12, offset: Offset(0, 6)),
    BoxShadow(color: Color(0x14101828), blurRadius: 36, offset: Offset(0, 18)),
  ];

  /// 배지·작은 칩·앱바 GP 알약.
  static const List<BoxShadow> small = [
    BoxShadow(color: Color(0x0F101828), blurRadius: 4, offset: Offset(0, 1)),
  ];

  /// 하단 고정 바(위로 드리우는 그림자).
  static const List<BoxShadow> bar = [
    BoxShadow(color: Color(0x0F101828), blurRadius: 20, offset: Offset(0, -6)),
  ];

  /// 시트·떠 있는 패널.
  static const List<BoxShadow> raised = [
    BoxShadow(color: Color(0x0D101828), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x1A101828), blurRadius: 32, offset: Offset(0, 14)),
  ];

  /// 색 있는 면(CTA·배너·패키지) 아래에 그 색으로 번지는 그림자.
  static List<BoxShadow> tinted(Color color, {double strength = 1}) => [
    BoxShadow(
      color: color.withValues(alpha: 0.22 * strength),
      blurRadius: 6,
      offset: const Offset(0, 3),
    ),
    BoxShadow(
      color: color.withValues(alpha: 0.26 * strength),
      blurRadius: 24,
      offset: const Offset(0, 12),
    ),
    BoxShadow(
      color: _ink.withValues(alpha: 0.06 * strength),
      blurRadius: 2,
      offset: const Offset(0, 1),
    ),
  ];
}

/// 셸 모션. 짧고 표준 커브만. 뽑기 연출의 타임라인은 reveal_timeline.dart.
class Motion {
  Motion._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 220);
  static const Duration slow = Duration(milliseconds: 300);

  /// 배너 자동 넘김 등 큰 이동.
  static const Duration page = Duration(milliseconds: 520);
  static const Curve curve = Curves.easeOutCubic;
  static const Curve emphasized = Curves.easeInOutCubic;
}
