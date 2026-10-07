import 'package:flutter/widgets.dart';

/// 4/8 그리드 간격 토큰. 화면 좌우 여백은 [gutter](20) 하나로 통일한다.
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

  /// 페이지 좌우 여백.
  static const double gutter = 20;

  /// 섹션 사이를 띄우는 회색 띠 높이 (그림자 대신 사용).
  static const double sectionGap = 8;

  static const EdgeInsets page = EdgeInsets.symmetric(horizontal: gutter);
}

/// 모서리 반경. 세 가지만 쓴다.
class Radii {
  Radii._();

  /// 칩·배지.
  static const double sm = 4;

  /// 썸네일·버튼·입력창.
  static const double md = 8;

  /// 카드·시트·다이얼로그.
  static const double lg = 12;

  static const BorderRadius chip = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius thumb = BorderRadius.all(Radius.circular(md));
  static const BorderRadius button = BorderRadius.all(Radius.circular(md));
  static const BorderRadius card = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius sheet = BorderRadius.vertical(
    top: Radius.circular(lg),
  );
}

/// 셸 모션. 짧고 표준 커브만.
class Motion {
  Motion._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 250);
  static const Curve curve = Curves.easeOutCubic;
}
