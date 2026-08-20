import 'package:flutter/material.dart';

/// 가치가차 - 앱 전역 컬러 상수
///
/// "화이트 앱 셸 + 다크 프로모션 요소"의 이중 톤(Dual-tone) 디자인 시스템.
/// 앱의 기본 배경/AppBar/하단 네비게이션/카드는 화이트~라이트그레이 톤을 사용하고,
/// 이벤트 배너와 같은 일부 프로모션 요소만 다크 배경 + 골드 포인트로 강조한다.
class AppColors {
  AppColors._();

  // ===== 화이트 앱 셸 =====
  /// 전체 앱 배경 (화이트)
  static const Color scaffoldBg = Color(0xFFFFFFFF);

  /// 기본 텍스트 (다크) — 화이트/라이트 배경 위에서 사용
  static const Color textPrimary = Color(0xFF1A1A1A);

  /// 보조 텍스트 — 화이트/라이트 배경 위에서 사용
  static const Color textSecondary = Color(0xFF999999);

  /// 이벤트 배너 등 다크 프로모션 요소에 사용되는 다크 배경
  static const Color darkSurface = Color(0xFF111111);

  /// 골드 포인트 컬러 (선택된 탭, 가격, 강조 텍스트/아이콘 등)
  static const Color goldPrimary = Color(0xFFFFB800);
  static const Color goldSecondary = Color(0xFFFF8C00);

  /// 카드 좌상단 뱃지 컬러
  static const Color badgeSpecial = Color(0xFFFF4444);
  static const Color badgeNew = Color(0xFF00CC66);

  /// darkSurface(다크 프로모션 배경) 위에 올라가는 텍스트/아이콘 컬러.
  /// textPrimary(다크)를 다크 배경에 그대로 쓰면 보이지 않으므로 별도로 정의.
  static const Color textOnDark = Color(0xFFF5F5F7);
  static const Color textOnDarkSecondary = Color(0xFFB5B5BD);

  /// 화이트 배경 위에 얹히는 카드/뱃지/다이얼로그 등의 옅은 회색 표면 & 보더
  static const Color surfaceElevated = Color(0xFFF7F7F7);
  static const Color surfaceBorder = Color(0xFFEAEAEA);
  static const Color surface = Color(0xFFF2F2F2);

  // ===== 하위 호환 별칭 =====
  // 기존 다크 퍼플 테마 코드가 참조하던 이름들을 새 팔레트로 매핑.
  // (다크 퍼플 포인트 컬러는 완전히 폐기되어 골드 포인트로 대체됨)
  static const Color primary = goldPrimary;
  static const Color primaryDark = goldSecondary;
  static const Color primaryLight = goldPrimary;

  static const Color gold = goldPrimary;
  static const Color goldDark = goldSecondary;

  /// 다크 프로모션 요소의 기본 배경 (darkSurface의 별칭)
  static const Color background = darkSurface;

  static const Color textDisabled = Color(0xFFCCCCCC);

  static const Color success = badgeNew;
  static const Color error = badgeSpecial;

  // ===== Gradients =====
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [goldPrimary, goldSecondary],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static LinearGradient get goldGradient => const LinearGradient(
    colors: [Color(0xFFFFC800), Color(0xFFFF8C00)],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  static const LinearGradient backgroundGradient = LinearGradient(
    colors: [Color(0xFF1B1B1F), Color(0xFF111111)],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );
}
