import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'holo.dart';
import 'product_image.dart';
import 'rarity_tag.dart';

/// 레어도 프레임.
///
/// N: 스틸 헤어라인 / R: 코발트 / SR: 자수정 금속 테두리 + 은은한 빛 /
/// SSR: 금박 테두리 + 금빛 후광 + (선택) 홀로 포일.
class RarityFrame extends StatelessWidget {
  final Rarity rarity;
  final Widget child;
  final double radius;

  /// SSR 홀로 반사광 애니메이션.
  final bool holo;

  /// 후광 세기 배율(0이면 후광 없음).
  final double glow;

  /// 홀로 반사광 세기(작은 카드는 낮게).
  final double holoIntensity;

  final Offset tilt;

  const RarityFrame({
    super.key,
    required this.rarity,
    required this.child,
    this.radius = 14,
    this.holo = false,
    this.glow = 1,
    this.holoIntensity = 0.6,
    this.tilt = Offset.zero,
  });

  @override
  Widget build(BuildContext context) {
    final border = switch (rarity) {
      Rarity.n => 1.0,
      Rarity.r => 1.2,
      Rarity.sr => 1.6,
      Rarity.ssr => 2.0,
    };
    final outer = BorderRadius.circular(radius);
    final inner = BorderRadius.circular(radius - border);
    Widget content = ClipRRect(borderRadius: inner, child: child);
    if (rarity == Rarity.ssr && holo) {
      content = HoloFoil(
        borderRadius: inner,
        intensity: holoIntensity,
        tilt: tilt,
        child: content,
      );
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: outer,
        gradient: rarity == Rarity.n
            ? null
            : rarity.foilGradient(
                begin: Alignment(-1 + tilt.dx * 0.6, -1),
                end: Alignment(1 + tilt.dx * 0.6, 1),
              ),
        color: rarity == Rarity.n
            ? AppColors.rarityN.withValues(alpha: 0.32)
            : null,
        boxShadow: glow <= 0 || rarity.rank < Rarity.r.rank
            ? null
            : [
                BoxShadow(
                  color: rarity.color.withValues(
                    alpha:
                        switch (rarity) {
                          Rarity.ssr => 0.42,
                          Rarity.sr => 0.32,
                          _ => 0.16,
                        } *
                        glow,
                  ),
                  blurRadius: switch (rarity) {
                    Rarity.ssr => 22,
                    Rarity.sr => 16,
                    _ => 10,
                  },
                  spreadRadius: rarity == Rarity.ssr ? 0.5 : 0,
                ),
              ],
      ),
      child: Padding(padding: EdgeInsets.all(border), child: content),
    );
  }
}

/// 컬렉터블 카드: 레어도 프레임 안에 상품 이미지(또는 엠블럼),
/// 좌상단 레어도 배지, 하단 이름·정보.
class CollectibleCard extends StatelessWidget {
  final Rarity rarity;
  final String name;
  final String? imageUrl;
  final ProductCategory category;

  /// 이름 아래 한 줄(정가 등).
  final String? meta;

  /// 우하단 강조 수치(확률 등).
  final String? trailing;

  /// 이미지 위 좌하단 라벨(보너스·천장).
  final List<String> labels;
  final bool holo;

  /// 이미지 영역 비율(가로/세로).
  final double imageAspect;
  final bool dense;

  const CollectibleCard({
    super.key,
    required this.rarity,
    required this.name,
    this.imageUrl,
    this.category = ProductCategory.jewel,
    this.meta,
    this.trailing,
    this.labels = const [],
    this.holo = false,
    this.imageAspect = 1,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final pad = dense ? 8.0 : 10.0;
    return RarityFrame(
      rarity: rarity,
      holo: holo,
      radius: dense ? 12 : 14,
      child: ColoredBox(
        color: AppColors.surface,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            AspectRatio(
              aspectRatio: imageAspect,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductImage(
                    url: imageUrl,
                    rarity: rarity,
                    name: name,
                    category: category,
                    borderRadius: BorderRadius.zero,
                  ),
                  Positioned(
                    left: pad - 2,
                    top: pad - 2,
                    child: RarityTag(rarity, dense: dense),
                  ),
                  if (labels.isNotEmpty)
                    Positioned(
                      left: pad - 2,
                      bottom: pad - 2,
                      child: Wrap(
                        spacing: 4,
                        children: [for (final l in labels) QuietLabel(l)],
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(pad, pad - 1, pad, pad),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: (dense ? AppText.caption : AppText.callout).copyWith(
                      color: AppColors.text,
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                    ),
                  ),
                  if (meta != null || trailing != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (meta != null)
                          Expanded(
                            child: Text(
                              meta!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style:
                                  AppText.num(
                                    dense ? AppText.micro : AppText.caption,
                                  ).copyWith(
                                    color: AppColors.text,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          )
                        else
                          const Spacer(),
                        if (trailing != null)
                          Text(
                            trailing!,
                            style:
                                AppText.num(
                                  dense ? AppText.micro : AppText.caption,
                                ).copyWith(
                                  color: rarity.light,
                                  fontWeight: FontWeight.w800,
                                ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
