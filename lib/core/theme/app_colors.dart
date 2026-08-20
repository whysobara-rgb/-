import 'package:flutter/material.dart';

/// 가치가차 - 앱 전역 컬러 상수.
///
/// "다크 차콜 + 네온 라임그린" 단일 톤 디자인 시스템 (실제 출시된 랜덤박스
/// 앱들의 UI 관용구를 따름). 앱 전체 배경/AppBar/하단 네비게이션/카드가
/// 모두 다크 차콜 계열이며, 강조 컬러로 네온 라임그린을 사용해 가격/CTA/
/// 선택 상태 등 핵심 정보를 눈에 띄게 강조한다.
class AppColors {
  AppColors._();

  // ===== 다크 차콜 베이스 =====
  /// 전체 앱 배경 (가장 어두운 톤)
  static const Color scaffoldBg = Color(0xFF121214);

  /// AppBar / 하단 네비게이션 등 셸 배경 (배경보다 살짝 밝은 톤)
  static const Color surfaceShell = Color(0xFF17171A);

  /// 카드/타일 표면 (셸보다 한 단계 밝은 톤)
  static const Color surfaceElevated = Color(0xFF1E1E22);

  /// 카드보다 한 단계 더 밝은 표면 (입력창, 칩, 강조 섹션 배경 등)
  static const Color surfaceElevated2 = Color(0xFF26262B);

  /// 다크 배경 위 얇은 구분선/보더
  static const Color surfaceBorder = Color(0xFF2E2E33);

  /// 레거시 alias — 다크 배경 자체를 가리키던 이름. 새 팔레트에서도
  /// scaffoldBg와 동일하게 매핑해 기존 코드가 계속 동작하도록 유지.
  static const Color darkSurface = scaffoldBg;
  static const Color surface = surfaceElevated;
  static const Color background = scaffoldBg;

  // ===== 네온 라임그린 강조 컬러 =====
  /// 메인 강조 컬러 (가격, CTA 버튼, 선택된 탭/뱃지 등)
  static const Color neonPrimary = Color(0xFFC9F32B);
  static const Color neonPrimaryDark = Color(0xFFA6D400);

  /// 레거시 alias — 기존 코드가 goldPrimary/goldSecondary를 참조하므로
  /// 새 강조색으로 매핑한다 (실제로는 더 이상 골드가 아니라 네온그린).
  static const Color goldPrimary = neonPrimary;
  static const Color goldSecondary = neonPrimaryDark;
  static const Color primary = neonPrimary;
  static const Color primaryDark = neonPrimaryDark;
  static const Color primaryLight = neonPrimary;
  static const Color gold = neonPrimary;
  static const Color goldDark = neonPrimaryDark;

  // ===== 텍스트 =====
  /// 다크 배경 위 기본 텍스트 (거의 화이트)
  static const Color textPrimary = Color(0xFFF5F5F7);

  /// 다크 배경 위 보조 텍스트 (뮤트 그레이)
  static const Color textSecondary = Color(0xFF9A9AA2);

  static const Color textDisabled = Color(0xFF5A5A60);

  /// 레거시 alias — 과거 "다크 프로모션 요소 위 텍스트" 개념이 이제
  /// 앱 전체 기본 텍스트와 동일해졌으므로 동일 값으로 매핑.
  static const Color textOnDark = textPrimary;
  static const Color textOnDarkSecondary = textSecondary;

  // ===== 뱃지/상태 컬러 =====
  static const Color badgeSpecial = Color(0xFFFF4D4F);
  static const Color badgeNew = Color(0xFF37D67A);
  static const Color badgeHot = Color(0xFFFF7A45);

  static const Color success = badgeNew;
  static const Color error = badgeSpecial;

  // ===== 레어도 컬러 (럭키 라인업 등에서 사용) =====
  static const Color rarityN = Color(0xFF9A9AA2);
  static const Color rarityR = Color(0xFF5FB4FF);
  static const Color raritySR = Color(0xFFC084FC);
  static const Color raritySSR = Color(0xFFC9F32B);

  // ===== Gradients =====
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [neonPrimary, neonPrimaryDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static LinearGradient get goldGradient => const LinearGradient(
    colors: [Color(0xFFDBFF4A), neonPrimaryDark],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  /// 상세 페이지 상단 비주얼 배너 등에 사용되는 다크 그라데이션.
  static const LinearGradient backgroundGradient = LinearGradient(
    colors: [Color(0xFF1D1D21), scaffoldBg],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );
}
