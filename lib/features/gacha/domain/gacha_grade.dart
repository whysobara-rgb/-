import 'package:flutter/material.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/theme/app_colors.dart';

/// 뽑기 연출 엔진의 4단계 강도(B < A < S < SSS).
///
/// 사용자에게 보이는 등급 표기는 백엔드 레어도(N/R/SR/SSR)를 그대로 쓰고,
/// 이 enum은 연출 강도·타임라인만 결정한다.
///   N → B (짧게 바로 개봉)
///   R → A (승급 연출)
///   SR → S (승급 + 컷인)
///   SSR → SSS (승급 + 컷인 + 금빛 파티클)
///
/// 승급(ascension) 색은 실제 결과 등급까지만 올라가고 멈춘다. 더 높은 등급의
/// 빛을 보여줬다가 낮은 결과를 내는 연출(니어미스)은 하지 않는다.
enum GachaGrade {
  b,
  a,
  s,
  sss;

  static GachaGrade fromRarity(Rarity rarity) => switch (rarity) {
    Rarity.n => GachaGrade.b,
    Rarity.r => GachaGrade.a,
    Rarity.sr => GachaGrade.s,
    Rarity.ssr => GachaGrade.sss,
  };

  Rarity get rarity => switch (this) {
    GachaGrade.b => Rarity.n,
    GachaGrade.a => Rarity.r,
    GachaGrade.s => Rarity.sr,
    GachaGrade.sss => Rarity.ssr,
  };

  /// 화면에 표기하는 코드는 레어도 코드다.
  String get code => rarity.code;

  int get rank => index;

  /// 컷인 단계가 있는 등급 (SR, SSR).
  bool get hasCutinStage => this == GachaGrade.s || this == GachaGrade.sss;

  /// 금빛 파티클이 쏟아지는 등급 (SSR).
  bool get hasRainbowConfetti => this == GachaGrade.sss;

  /// SSR 전용 금속 광택 표현 여부.
  bool get isRainbow => this == GachaGrade.sss;

  /// 스테이지별 길이(ms) — [박스 등장, 균열/승급, 컷인, 개봉].
  /// 컷인이 0이면 해당 단계를 건너뛴다.
  List<int> get stageDurationsMs => switch (this) {
    GachaGrade.b => const [600, 500, 0, 400],
    GachaGrade.a => const [1000, 1200, 0, 800],
    GachaGrade.s => const [1000, 1500, 700, 800],
    GachaGrade.sss => const [1000, 1500, 700, 1000],
  };

  Duration get totalDuration => Duration(
    milliseconds: stageDurationsMs.fold<int>(0, (sum, v) => sum + v),
  );

  /// 균열 단계에서 차례로 거치는 빛 색. 실제 등급 색에서 멈춘다.
  List<Color> get ascensionColors {
    const white = Color(0xFFF4F4F5);
    switch (this) {
      case GachaGrade.b:
        return const [white, Color(0xFFBDBDC2)];
      case GachaGrade.a:
        return const [white, _lightR];
      case GachaGrade.s:
        return const [white, _lightR, _lightSR];
      case GachaGrade.sss:
        return const [white, _lightR, _lightSR, _lightSSR];
    }
  }

  /// 어두운 무대 위에서 쓰는 등급 빛 색(셸의 레어도 색보다 밝게 보정).
  Color get primaryColor => switch (this) {
    GachaGrade.b => const Color(0xFFBDBDC2),
    GachaGrade.a => _lightR,
    GachaGrade.s => _lightSR,
    GachaGrade.sss => _lightSSR,
  };

  /// 보조 하이라이트.
  Color get secondaryColor => switch (this) {
    GachaGrade.b => Colors.white,
    GachaGrade.a => const Color(0xFFBFD4FF),
    GachaGrade.s => const Color(0xFFD9C6FF),
    GachaGrade.sss => const Color(0xFFFFF1C9),
  };

  /// 등급 카드·컷인 배지 면 처리. SSR만 금속성 그라데이션.
  LinearGradient get gradient => switch (this) {
    GachaGrade.b => const LinearGradient(
      colors: [Color(0xFF3A3A3F), Color(0xFF2A2A2E)],
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
    ),
    GachaGrade.a => const LinearGradient(
      colors: [Color(0xFF3D74F0), AppColors.rarityR],
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
    ),
    GachaGrade.s => const LinearGradient(
      colors: [Color(0xFF8E58EE), AppColors.raritySR],
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
    ),
    GachaGrade.sss => const LinearGradient(
      colors: [
        AppColors.raritySSRLight,
        AppColors.raritySSR,
        AppColors.raritySSRDeep,
        AppColors.raritySSR,
      ],
      stops: [0, 0.45, 0.8, 1],
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
    ),
  };

  Color get glowColor => primaryColor;

  static const Color _lightR = Color(0xFF6E9BFF);
  static const Color _lightSR = Color(0xFFA77BFF);
  static const Color _lightSSR = Color(0xFFF2C14E);
}

/// SSR 개봉 시 흩날리는 금박 팔레트(금·샴페인·백색).
const List<Color> kGoldLeafPalette = [
  Color(0xFFF2C14E),
  Color(0xFFFFE3A1),
  Color(0xFFFFFFFF),
  Color(0xFFD9A43A),
  Color(0xFFFFF4D6),
  Color(0xFFB8862B),
];
