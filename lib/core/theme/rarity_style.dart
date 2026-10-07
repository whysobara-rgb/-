import 'package:flutter/material.dart';
import '../domain/rarity.dart';
import 'app_colors.dart';

/// 레어도의 화면 표현(밝은 테마). 도메인 enum([Rarity])은 그대로 두고
/// 색·포일·연출 무대 색면은 여기서만 정한다.
extension RarityStyle on Rarity {
  /// 흰 바탕 위 글자색(확률·정가 강조). [Rarity.light]는 포일 하이라이트라
  /// 글자에 쓰면 안 보인다.
  Color get ink => switch (this) {
    Rarity.n => AppColors.rarityNInk,
    Rarity.r => AppColors.rarityRInk,
    Rarity.sr => AppColors.raritySRInk,
    Rarity.ssr => AppColors.raritySSRInk,
  };

  /// 상품 우물(이미지 바탕)에 아주 옅게 깔리는 등급 기운.
  Color get wash => Color.lerp(AppColors.well, color, switch (this) {
    Rarity.n => 0.0,
    Rarity.r => 0.07,
    Rarity.sr => 0.08,
    Rarity.ssr => 0.12,
  })!;

  /// 카드 프레임 두께.
  double get frameWidth => switch (this) {
    Rarity.n => 1.0,
    Rarity.r => 1.6,
    Rarity.sr => 2.2,
    Rarity.ssr => 2.6,
  };

  /// 등급 색으로 번지는 카드 그림자(N은 중립 그림자).
  List<BoxShadow> glow([double strength = 1]) {
    if (this == Rarity.n) {
      return [
        BoxShadow(
          color: const Color(0xFF101828).withValues(alpha: 0.05 * strength),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
        BoxShadow(
          color: const Color(0xFF101828).withValues(alpha: 0.07 * strength),
          blurRadius: 14,
          offset: const Offset(0, 6),
        ),
      ];
    }
    final a = switch (this) {
      Rarity.r => 0.18,
      Rarity.sr => 0.26,
      _ => 0.34,
    };
    return [
      BoxShadow(
        color: deep.withValues(alpha: 0.10 * strength),
        blurRadius: 2,
        offset: const Offset(0, 1),
      ),
      BoxShadow(
        color: color.withValues(alpha: a * strength),
        blurRadius: this == Rarity.ssr ? 22 : 16,
        offset: const Offset(0, 8),
      ),
    ];
  }

  /// 뽑기 연출 무대 색면(가운데 → 중간 → 가장자리). 등급이 오를수록
  /// 슬레이트 → 블루 → 바이올렛 → 빛나는 금으로 밝고 진해진다.
  StageField get field => switch (this) {
    Rarity.n => const StageField(
      Color(0xFF7487B0),
      Color(0xFF3A4A74),
      Color(0xFF1A2244),
    ),
    Rarity.r => const StageField(
      Color(0xFF4B8DFF),
      Color(0xFF1D52DA),
      Color(0xFF0A1F72),
    ),
    Rarity.sr => const StageField(
      Color(0xFFB06BFF),
      Color(0xFF6A25DA),
      Color(0xFF240A66),
    ),
    Rarity.ssr => const StageField(
      Color(0xFFFFF0B8),
      Color(0xFFF7B21A),
      Color(0xFFB45A00),
    ),
  };

  /// 무대 위 빛(빛줄기·입자·충격파) 색. 색면보다 밝다.
  Color get stageLight => switch (this) {
    Rarity.n => const Color(0xFFE3EAF7),
    Rarity.r => const Color(0xFF9CC2FF),
    Rarity.sr => const Color(0xFFDAB6FF),
    Rarity.ssr => const Color(0xFFFFE48A),
  };
}

/// 연출 무대의 방사형 색면 세 단계.
@immutable
class StageField {
  final Color center;
  final Color mid;
  final Color edge;
  const StageField(this.center, this.mid, this.edge);

  static StageField lerp(StageField a, StageField b, double t) => StageField(
    Color.lerp(a.center, b.center, t)!,
    Color.lerp(a.mid, b.mid, t)!,
    Color.lerp(a.edge, b.edge, t)!,
  );

  /// 전체를 [amount]만큼 흰색 쪽으로(승급 섬광).
  StageField brighten(double amount) => StageField(
    Color.lerp(center, Colors.white, amount)!,
    Color.lerp(mid, Colors.white, amount * 0.8)!,
    Color.lerp(edge, Colors.white, amount * 0.5)!,
  );

  @override
  bool operator ==(Object other) =>
      other is StageField &&
      other.center == center &&
      other.mid == mid &&
      other.edge == edge;

  @override
  int get hashCode => Object.hash(center, mid, edge);
}
