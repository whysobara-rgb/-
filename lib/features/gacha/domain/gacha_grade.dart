import 'package:flutter/material.dart';

/// 가치가차 - CLOVE 오리파 스타일 4등급 체계.
///
/// 백엔드 rarity(N/R/SR/SSR)는 [GradeMapper]를 통해 이 4등급 코드
/// ('B'/'A'/'S'/'SSS')로 변환된다. B가 가장 낮고 SSS가 최고 등급(잭팟)이다.
enum GachaGrade {
  b,
  a,
  s,
  sss;

  /// UI/서버에서 사용하는 등급 코드 문자열.
  String get code {
    switch (this) {
      case GachaGrade.b:
        return 'B';
      case GachaGrade.a:
        return 'A';
      case GachaGrade.s:
        return 'S';
      case GachaGrade.sss:
        return 'SSS';
    }
  }

  /// 등급 한글 라벨.
  String get label {
    switch (this) {
      case GachaGrade.b:
        return '기본';
      case GachaGrade.a:
        return '선방';
      case GachaGrade.s:
        return '대박';
      case GachaGrade.sss:
        return '초대박';
    }
  }

  /// 등급 순위 (숫자가 클수록 높은 등급). 정렬/최고등급 판별에 사용.
  int get rank {
    switch (this) {
      case GachaGrade.b:
        return 0;
      case GachaGrade.a:
        return 1;
      case GachaGrade.s:
        return 2;
      case GachaGrade.sss:
        return 3;
    }
  }

  /// Stage3(슬로우모션 컷인)이 존재하는 등급인지 여부 (S, SSS 전용).
  bool get hasCutinStage => this == GachaGrade.s || this == GachaGrade.sss;

  /// Stage4에서 무지개 3D 컨페티 폭발이 추가되는지 여부 (SSS 전용).
  bool get hasRainbowConfetti => this == GachaGrade.sss;

  /// 오로라 레인보우 셰이더가 적용되는지 여부 (SSS 전용).
  bool get isRainbow => this == GachaGrade.sss;

  /// 스테이지별 연출 길이(ms) — [orb 소환, crack/승급, cutin(컷인), burst(폭발/카드등장)].
  /// cutin 값이 0이면 해당 등급은 Stage3(컷인)을 건너뛴다.
  /// CLOVE식 5단계 타임라인 스펙(0~1.0s / 1.0~2.5s / 2.5~3.2s / 3.2~4.2s)을
  /// 기반으로 하되, B/A 등급은 텐션을 낮춰 컷인 없이 빠르게 진행한다.
  List<int> get stageDurationsMs {
    switch (this) {
      case GachaGrade.b:
        return const [600, 500, 0, 400]; // 총 1.5s - 즉시 파열
      case GachaGrade.a:
        return const [1000, 1200, 0, 800]; // 총 3.0s - 컷인 없이 승급만
      case GachaGrade.s:
        return const [1000, 1500, 700, 800]; // 총 4.0s
      case GachaGrade.sss:
        return const [1000, 1500, 700, 1000]; // 총 4.2s (+컨페티)
    }
  }

  /// 등급별 전체 연출 타임라인 총 길이 (stageDurationsMs 합).
  Duration get totalDuration {
    final total = stageDurationsMs.fold<int>(0, (sum, v) => sum + v);
    return Duration(milliseconds: total);
  }

  /// Stage2(크랙/승급)에서 순차적으로 거치는 색상 팔레트.
  /// B는 흰색 고정, A는 흰->보라, S는 흰->보라->골드,
  /// SSS는 흰->보라->골드->레인보우(마지막 구간은 hue 회전으로 특수 처리).
  List<Color> get ascensionColors {
    const white = Colors.white;
    const violet = Color(0xFF9B6BFF);
    const gold = Color(0xFFFFC94A);
    const rainbowSeed = Color(0xFFFF4FD8);
    switch (this) {
      case GachaGrade.b:
        return const [white, Color(0xFFE3E7EF)];
      case GachaGrade.a:
        return const [white, violet];
      case GachaGrade.s:
        return const [white, violet, gold];
      case GachaGrade.sss:
        return const [white, violet, gold, rainbowSeed];
    }
  }

  /// 등급 메인 컬러 (뱃지/텍스트 등에 사용).
  Color get primaryColor {
    switch (this) {
      case GachaGrade.b:
        return const Color(0xFFAEB6C4);
      case GachaGrade.a:
        return const Color(0xFF9B6BFF);
      case GachaGrade.s:
        return const Color(0xFFFFC94A);
      case GachaGrade.sss:
        return const Color(0xFFFF4FD8);
    }
  }

  /// 등급 보조 컬러.
  Color get secondaryColor {
    switch (this) {
      case GachaGrade.b:
        return Colors.white;
      case GachaGrade.a:
        return const Color(0xFF4FC3F7);
      case GachaGrade.s:
        return const Color(0xFFFF4FD8);
      case GachaGrade.sss:
        return const Color(0xFFFFD54A);
    }
  }

  /// 등급 대표 그라데이션 (뱃지/카드 테두리/버튼 배경 등에 사용).
  LinearGradient get gradient {
    switch (this) {
      case GachaGrade.b:
        return const LinearGradient(
          colors: [Color(0xFFF4F6FA), Color(0xFFC7CEDB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );
      case GachaGrade.a:
        return const LinearGradient(
          colors: [Color(0xFFB18CFF), Color(0xFF4FC3F7)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );
      case GachaGrade.s:
        return const LinearGradient(
          colors: [Color(0xFFFFE08A), Color(0xFFFFC94A), Color(0xFFFF4FD8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );
      case GachaGrade.sss:
        return const LinearGradient(
          colors: [
            Color(0xFFFF4D6D),
            Color(0xFFFFC94A),
            Color(0xFF4FE0B0),
            Color(0xFF4FA8FF),
            Color(0xFFB05CE0),
            Color(0xFFFF4FD8),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );
    }
  }

  /// 배경 딥 다크 모달 위에서 방출되는 아우라(글로우) 컬러.
  Color get glowColor => primaryColor;

  static GachaGrade fromCode(String? code) {
    switch (code) {
      case 'SSS':
        return GachaGrade.sss;
      case 'S':
        return GachaGrade.s;
      case 'A':
        return GachaGrade.a;
      case 'B':
      default:
        return GachaGrade.b;
    }
  }
}

/// 무지개(오로라) 연출에 사용되는 순환 컬러 팔레트.
const List<Color> kRainbowPalette = [
  Color(0xFFFF4D6D),
  Color(0xFFFF9457),
  Color(0xFFFFD54A),
  Color(0xFF4FE0B0),
  Color(0xFF4FA8FF),
  Color(0xFFB05CE0),
  Color(0xFFFF4FD8),
];

/// [t]（0~1, 반복 가능한 무한 진행값)에 대응하는 무지개 팔레트 보간 컬러.
Color rainbowColorAt(double t) {
  final normalized = t - t.floorToDouble();
  final scaled = normalized * kRainbowPalette.length;
  final index = scaled.floor() % kRainbowPalette.length;
  final nextIndex = (index + 1) % kRainbowPalette.length;
  final localT = scaled - scaled.floorToDouble();
  return Color.lerp(
        kRainbowPalette[index],
        kRainbowPalette[nextIndex],
        localT,
      ) ??
      kRainbowPalette[index];
}
