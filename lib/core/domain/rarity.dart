import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// 백엔드 아이템 레어도(N < R < SR < SSR).
///
/// 앱 전체에서 사용자에게 보이는 등급 표기는 이 코드 하나로 통일한다
/// (확률 공시 표와 결과 화면의 표기가 같아야 하기 때문).
enum Rarity {
  n('N', '노멀'),
  r('R', '레어'),
  sr('SR', '슈퍼 레어'),
  ssr('SSR', '최상위');

  const Rarity(this.code, this.label);

  final String code;
  final String label;

  /// 높을수록 희귀.
  int get rank => index;

  Color get color => switch (this) {
    Rarity.n => AppColors.rarityN,
    Rarity.r => AppColors.rarityR,
    Rarity.sr => AppColors.raritySR,
    Rarity.ssr => AppColors.raritySSR,
  };

  Color get tint => switch (this) {
    Rarity.n => AppColors.rarityNTint,
    Rarity.r => AppColors.rarityRTint,
    Rarity.sr => AppColors.raritySRTint,
    Rarity.ssr => AppColors.raritySSRTint,
  };

  static Rarity fromCode(Object? code) => switch (code) {
    'SSR' => Rarity.ssr,
    'SR' => Rarity.sr,
    'R' => Rarity.r,
    _ => Rarity.n,
  };

  /// 희귀한 순(SSR → N) 정렬용 비교자.
  static int rarestFirst(Rarity a, Rarity b) => b.rank.compareTo(a.rank);
}
