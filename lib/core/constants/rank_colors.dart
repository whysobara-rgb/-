import 'package:flutter/material.dart';

/// 가치가차 - 등급별 컬러 상수
///
/// 프리미엄 가챠 등급 컬러 시스템. 문자열 등급 코드("S"/"A"/"B"/"C")를
/// 기준으로 컬러를 조회한다. S(최고 등급, 골드) > A(퍼플) > B(블루) > C(그레이) 순서.
/// 가챠(뽑기) 화면과 보관함(인벤토리) 화면 등 여러 기능에서 공통으로 사용된다.
class RankColors {
  RankColors._();

  /// S등급 - 골드 (최고 등급, 레전더리)
  static const Color s = Color(0xFFFFC94A);
  static const Color sDark = Color(0xFFB8860B);

  /// A등급 - 퍼플 (레어)
  static const Color a = Color(0xFFA36BFF);
  static const Color aDark = Color(0xFF6A3FBF);

  /// B등급 - 블루 (언커먼)
  static const Color b = Color(0xFF4FC3F7);
  static const Color bDark = Color(0xFF2A7DAF);

  /// C등급 - 그레이 (커먼)
  static const Color c = Color(0xFF9AA0A6);
  static const Color cDark = Color(0xFF6B7075);

  /// 등급 코드("S"/"A"/"B"/"C")에 해당하는 메인 컬러 반환.
  static Color of(String grade) {
    switch (grade) {
      case 'S':
        return s;
      case 'A':
        return a;
      case 'B':
        return b;
      case 'C':
        return c;
      default:
        return c;
    }
  }

  /// 등급 코드에 해당하는 다크 톤 컬러 반환 (그라디언트/그림자용).
  static Color darkOf(String grade) {
    switch (grade) {
      case 'S':
        return sDark;
      case 'A':
        return aDark;
      case 'B':
        return bDark;
      case 'C':
        return cDark;
      default:
        return cDark;
    }
  }
}
