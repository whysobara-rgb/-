import 'package:flutter/material.dart';
import '../../features/gacha/domain/gacha_grade.dart';

/// 가치가차 - 등급별 컬러 상수
///
/// CLOVE 오리파 스타일 4등급 체계. 문자열 등급 코드("B"/"A"/"S"/"SSS")를
/// 기준으로 컬러를 조회한다. SSS(최고 등급, 잭팟) > S(대박) > A(선방) > B(기본)
/// 순서. 가챠(뽑기) 화면과 보관함(인벤토리) 화면 등 여러 기능에서 공통으로
/// 사용된다. 실제 컬러 정의는 [GachaGrade]에 위임한다.
class RankColors {
  RankColors._();

  /// SSS등급 - 레인보우/마젠타 (최고 등급, 잭팟)
  static Color get sss => GachaGrade.sss.primaryColor;
  static Color get sssDark => const Color(0xFFB8258A);

  /// S등급 - 골드 (대박, 상위 1%)
  static Color get s => GachaGrade.s.primaryColor;
  static Color get sDark => const Color(0xFFB8860B);

  /// A등급 - 퍼플 (선방)
  static Color get a => GachaGrade.a.primaryColor;
  static Color get aDark => const Color(0xFF6A3FBF);

  /// B등급 - 실버/화이트 (기본)
  static Color get b => GachaGrade.b.primaryColor;
  static Color get bDark => const Color(0xFF6B7075);

  /// 등급 코드("B"/"A"/"S"/"SSS")에 해당하는 메인 컬러 반환.
  /// 레거시 등급 코드("C")가 들어와도 B로 폴백한다.
  static Color of(String grade) => GachaGrade.fromCode(grade).primaryColor;

  /// 등급 코드에 해당하는 다크 톤 컬러 반환 (그라디언트/그림자용).
  static Color darkOf(String grade) {
    switch (GachaGrade.fromCode(grade)) {
      case GachaGrade.sss:
        return sssDark;
      case GachaGrade.s:
        return sDark;
      case GachaGrade.a:
        return aDark;
      case GachaGrade.b:
        return bDark;
    }
  }
}
