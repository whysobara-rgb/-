import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// 백엔드 아이템 레어도(N < R < SR < SSR).
///
/// 앱 전체에서 사용자에게 보이는 등급 표기는 이 코드 하나로 통일한다
/// (확률 공시 표와 결과 화면의 표기가 같아야 하기 때문).
/// 레어도 색은 나이트 볼트의 주인공 팔레트다 — 레어도를 뜻할 때만 쓴다.
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

  /// SR 이상: 금속 포일 처리, 결과 화면 축하 연출 대상.
  bool get isFoil => rank >= Rarity.sr.rank;

  /// 기본 색(텍스트·테두리·막대).
  Color get color => switch (this) {
    Rarity.n => AppColors.rarityN,
    Rarity.r => AppColors.rarityR,
    Rarity.sr => AppColors.raritySR,
    Rarity.ssr => AppColors.raritySSR,
  };

  /// 하이라이트(빛나는 가장자리, 어두운 무대 위 빛 색).
  Color get light => switch (this) {
    Rarity.n => AppColors.rarityNLight,
    Rarity.r => AppColors.rarityRLight,
    Rarity.sr => AppColors.raritySRLight,
    Rarity.ssr => AppColors.raritySSRLight,
  };

  /// 그림자 쪽 톤(포일 그라데이션의 어두운 끝).
  Color get deep => switch (this) {
    Rarity.n => AppColors.rarityNDeep,
    Rarity.r => AppColors.rarityRDeep,
    Rarity.sr => AppColors.raritySRDeep,
    Rarity.ssr => AppColors.raritySSRDeep,
  };

  /// 어두운 표면 위 옅은 바탕(배지·카드 안쪽).
  Color get tint => color.withValues(alpha: this == Rarity.n ? 0.12 : 0.16);

  /// 단색 배지 위 글씨. 밝은 금·스틸 위에는 먹색, 파랑·보라 위에는 흰색.
  Color get onColor => switch (this) {
    Rarity.n || Rarity.ssr => const Color(0xFF15120A),
    Rarity.r || Rarity.sr => Colors.white,
  };

  /// 프레임·배지 면 그라데이션. N/R은 거의 단색, SR/SSR은 금속성.
  List<Color> get foil => switch (this) {
    Rarity.n => const [AppColors.rarityNLight, AppColors.rarityN],
    Rarity.r => const [Color(0xFF7FAEFF), AppColors.rarityR],
    Rarity.sr => const [
      AppColors.raritySRLight,
      AppColors.raritySR,
      AppColors.raritySRDeep,
      AppColors.raritySR,
    ],
    Rarity.ssr => const [
      AppColors.raritySSRLight,
      AppColors.raritySSR,
      AppColors.raritySSRDeep,
      Color(0xFFFFE08A),
      AppColors.raritySSR,
    ],
  };

  List<double>? get foilStops => switch (this) {
    Rarity.n || Rarity.r => null,
    Rarity.sr => const [0, 0.35, 0.72, 1],
    Rarity.ssr => const [0, 0.3, 0.58, 0.8, 1],
  };

  LinearGradient foilGradient({
    Alignment begin = Alignment.topLeft,
    Alignment end = Alignment.bottomRight,
  }) => LinearGradient(begin: begin, end: end, colors: foil, stops: foilStops);

  static Rarity fromCode(Object? code) => switch (code) {
    'SSR' => Rarity.ssr,
    'SR' => Rarity.sr,
    'R' => Rarity.r,
    _ => Rarity.n,
  };

  /// 희귀한 순(SSR → N) 정렬용 비교자.
  static int rarestFirst(Rarity a, Rarity b) => b.rank.compareTo(a.rank);
}
