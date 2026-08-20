import 'package:flutter/material.dart';

/// 가치가차 - 앱 전역 컬러 상수.
///
/// "비비드 파스텔 팝(Vivid Pastel Pop)" 디자인 시스템.
/// 따뜻한 크림 화이트를 기본 배경으로 하고, 코랄·바이올렛·민트·옐로우 등
/// 여러 비비드 포인트 컬러를 함께 사용해 단조롭지 않으면서도 과하게
/// 어둡지 않은 트렌디한 MZ 감성의 라이트 테마를 구성한다.
class AppColors {
  AppColors._();

  // ===== 배경 (크림 화이트 베이스) =====
  /// 전체 앱 배경 (따뜻한 크림톤, 순백색보다 부드러운 느낌)
  static const Color scaffoldBg = Color(0xFFFFF8EF);

  /// AppBar / 하단 네비게이션 등 셸 배경 (선명한 화이트)
  static const Color surfaceShell = Color(0xFFFFFFFF);

  /// 카드/타일 표면 (화이트, 그림자로 배경과 구분)
  static const Color surfaceElevated = Color(0xFFFFFFFF);

  /// 카드보다 한 단계 톤 다운된 표면 (입력창, 비활성 칩, 구분 섹션 배경 등)
  static const Color surfaceElevated2 = Color(0xFFF7F1E6);

  /// 크림 배경 위 얇은 구분선/보더 (매우 연한 웜그레이)
  static const Color surfaceBorder = Color(0xFFF0E7D8);

  /// 히어로 배너/포인트 카드 등에 쓰이는 비비드 딥 톤 (검정이 아닌 딥 플럼).
  /// 필요한 곳에서만 제한적으로 사용해 "너무 어두운" 느낌을 피한다.
  static const Color heroDeep = Color(0xFF3A2358);

  /// 레거시 alias — 예전 다크 테마의 "다크 배경" 개념을 가리키던 이름들을
  /// 새 라이트 팔레트에 맞게 매핑해 기존 코드가 계속 동작하도록 유지.
  static const Color darkSurface = heroDeep;
  static const Color surface = surfaceElevated;
  static const Color background = scaffoldBg;

  // ===== 메인 액센트 - 비비드 코랄 =====
  /// 메인 강조 컬러 (가격, CTA 버튼, 선택된 탭/뱃지 등)
  static const Color primary = Color(0xFFFF6B4A);
  static const Color primaryDark = Color(0xFFE24E2E);
  static const Color primaryLight = Color(0xFFFF9478);

  /// 레거시 alias — 기존 코드가 goldPrimary/neonPrimary 등을 참조하므로
  /// 새 코랄 강조색으로 매핑한다.
  static const Color goldPrimary = primary;
  static const Color goldSecondary = primaryDark;
  static const Color neonPrimary = primary;
  static const Color neonPrimaryDark = primaryDark;
  static const Color gold = primary;
  static const Color goldDark = primaryDark;

  // ===== 서브 액센트 (멀티 비비드 컬러 - 단조로움 방지) =====
  static const Color accentViolet = Color(0xFF8B5CF6);
  static const Color accentMint = Color(0xFF17B894);
  static const Color accentSky = Color(0xFF4FA8FF);
  static const Color accentYellow = Color(0xFFFFC93C);

  /// 퀵메뉴/아이콘 로우 등에서 순환 사용할 멀티 액센트 팔레트.
  static const List<Color> multiAccents = [
    primary,
    accentViolet,
    accentMint,
    accentYellow,
    accentSky,
  ];

  // ===== 텍스트 =====
  /// 기본 텍스트 (완전한 검정이 아닌 부드러운 다크 차콜)
  static const Color textPrimary = Color(0xFF2B2430);

  /// 보조 텍스트 (뮤트 웜그레이)
  static const Color textSecondary = Color(0xFF8D8593);

  static const Color textDisabled = Color(0xFFD6CFDA);

  /// 비비드 그라데이션/딥 톤 카드(히어로 배너, GP 카드 등) 위에서 쓰는
  /// 전용 텍스트 컬러. 크림 배경용 textPrimary/textSecondary와 달리
  /// 채도 높은 배경 위에서도 또렷하게 보이도록 화이트 계열로 고정한다.
  static const Color textOnDark = Colors.white;
  static const Color textOnDarkSecondary = Color(0xFFF0E6FA);

  // ===== 뱃지/상태 컬러 =====
  static const Color badgeSpecial = Color(0xFFFF4D6D);
  static const Color badgeNew = accentMint;
  static const Color badgeHot = Color(0xFFFF7A45);

  static const Color success = accentMint;
  static const Color error = Color(0xFFE63950);

  // ===== 레어도 컬러 (럭키 라인업 등에서 사용) =====
  static const Color rarityN = Color(0xFF9A94A0);
  static const Color rarityR = accentSky;
  static const Color raritySR = accentViolet;
  static const Color raritySSR = Color(0xFFFFC94A);

  // ===== Gradients =====
  /// 메인 CTA 버튼/로고 등에 쓰이는 코랄 그라데이션.
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFFFF8A65), primaryDark],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  static LinearGradient get goldGradient => primaryGradient;

  /// 히어로 배너/GP 잔액 카드/캡슐 오픈 연출 등 "비비드하지만 어둡지 않은"
  /// 강조 표면에 쓰이는 코랄→바이올렛 대각선 그라데이션.
  static const LinearGradient heroGradient = LinearGradient(
    colors: [Color(0xFFFF7A59), accentViolet],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 두 번째 히어로 배리에이션 (민트→스카이블루) - 배너 카루셀 등에서
  /// 여러 장을 넘길 때 색이 반복되지 않도록 다양성을 준다.
  static const LinearGradient heroGradientMint = LinearGradient(
    colors: [accentMint, accentSky],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 세 번째 히어로 배리에이션 (옐로우→코랄).
  static const LinearGradient heroGradientYellow = LinearGradient(
    colors: [accentYellow, primary],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 상세 페이지 상단 비주얼 배너 등에 사용되는 크림 그라데이션 (다크 X).
  static const LinearGradient backgroundGradient = LinearGradient(
    colors: [Color(0xFFFFF1DE), scaffoldBg],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  // ===== Claymorphism & Pastel 3D 전용 토큰 =====

  /// 로고 워드마크 (오렌지 → 바이올렛)
  static const LinearGradient logoGradient = LinearGradient(
    colors: [Color(0xFFFF7A45), Color(0xFF8B5CF6)],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  /// 메인 럭키 PICK 배너용 오가닉 멀티스톱 그라데이션
  /// (코랄 오렌지 → 바이올렛 → 스카이블루)
  static const LinearGradient luckyBannerGradient = LinearGradient(
    colors: [
      Color(0xFFFF7A59),
      Color(0xFFB05CE0),
      Color(0xFF8B5CF6),
      Color(0xFF4FA8FF),
    ],
    stops: [0.0, 0.4, 0.7, 1.0],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// GP 포인트 뱃지 (노란 오벌 3D 코인칩) 그라데이션
  static const LinearGradient coinGradient = LinearGradient(
    colors: [Color(0xFFFFE08A), accentYellow],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 퀵메뉴 클레이 원형 배경 - 무료뽑기(주황)
  static const LinearGradient clayOrange = LinearGradient(
    colors: [Color(0xFFFFA26B), Color(0xFFFF6B3D)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 퀵메뉴 클레이 원형 배경 - 컬렉션(민트)
  static const LinearGradient clayMint = LinearGradient(
    colors: [Color(0xFF6EE7C8), Color(0xFF17B894)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 퀵메뉴 클레이 원형 배경 - 가게(보라)
  static const LinearGradient clayViolet = LinearGradient(
    colors: [Color(0xFFB08CF9), accentViolet],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 퀵메뉴 클레이 원형 배경 - 혜택(노랑)
  static const LinearGradient clayYellow = LinearGradient(
    colors: [Color(0xFFFFDD7A), accentYellow],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 퀵메뉴 클레이 원형 배경 - 커뮤니티(하늘)
  static const LinearGradient claySky = LinearGradient(
    colors: [Color(0xFF8BCBFF), accentSky],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 상품 카드 HOT 리본 (주황)
  static const LinearGradient ribbonHot = LinearGradient(
    colors: [Color(0xFFFF9457), Color(0xFFFF6B3D)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 상품 카드 NEW 리본 (민트)
  static const LinearGradient ribbonNew = LinearGradient(
    colors: [Color(0xFF6EE7C8), Color(0xFF12A37E)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// 하단 네비게이션 선택 아이템 소프트 원형 배경 그라데이션
  static const LinearGradient navActiveGradient = LinearGradient(
    colors: [Color(0xFFFF8A65), accentViolet],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
