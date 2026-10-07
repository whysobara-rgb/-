import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../core/theme/rarity_style.dart';
import '../../core/utils/format.dart';
import 'holo.dart';
import 'product_image.dart';
import 'rarity_tag.dart';

/// 레어도 프레임.
///
/// N: 깨끗한 헤어라인 / R: 블루 테두리 / SR: 퍼플 포일 테두리 + 퍼플 그림자 /
/// SSR: 금박 테두리 + 금빛 그림자 + (선택) 홀로 포일.
class RarityFrame extends StatelessWidget {
  final Rarity rarity;
  final Widget child;
  final double radius;

  /// SSR 홀로 반사광.
  final bool holo;

  /// 그림자 세기 배율(0이면 그림자 없음).
  final double glow;

  /// 홀로 반사광 세기(작은 카드는 낮게).
  final double holoIntensity;

  /// false면 반사광이 멈춘 채로 그려진다(목록처럼 여러 장이 한 화면에
  /// 있을 때 계속 다시 그리지 않게).
  final bool holoAnimate;

  final Offset tilt;

  const RarityFrame({
    super.key,
    required this.rarity,
    required this.child,
    this.radius = 14,
    this.holo = false,
    this.glow = 1,
    this.holoIntensity = 0.6,
    this.holoAnimate = true,
    this.tilt = Offset.zero,
  });

  @override
  Widget build(BuildContext context) {
    final border = rarity == Rarity.n
        ? 1.0
        : rarity.frameWidth * (radius < 10 ? 0.75 : 1);
    final outer = BorderRadius.circular(radius);
    final inner = BorderRadius.circular((radius - border).clamp(0, radius));
    Widget content = ClipRRect(borderRadius: inner, child: child);
    if (rarity == Rarity.ssr && holo) {
      content = HoloFoil(
        borderRadius: inner,
        intensity: holoIntensity,
        animate: holoAnimate,
        tilt: tilt,
        sparkles: radius < 10 ? 3 : 12,
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
        color: rarity == Rarity.n ? const Color(0xFFE3E6EA) : null,
        boxShadow: glow <= 0 ? null : rarity.glow(glow),
      ),
      child: Padding(padding: EdgeInsets.all(border), child: content),
    );
  }
}

/// 컬렉터블 카드: 레어도 프레임 안에 상품 사진(또는 상품 일러스트),
/// 좌상단 레어도 배지, 하단 이름·정가·확률.
class CollectibleCard extends StatelessWidget {
  final Rarity rarity;
  final String name;
  final String? imageUrl;
  final ProductCategory category;

  /// 이름 아래 한 줄(정가 등).
  final String? meta;

  /// 우하단 강조 수치(확률 등). 레어도 색 알약으로 그린다.
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
    final pad = dense ? 8.0 : 11.0;
    return RarityFrame(
      rarity: rarity,
      holo: holo,
      holoAnimate: false,
      holoIntensity: 0.55,
      radius: dense ? 12 : 16,
      glow: dense ? 0.6 : 1,
      child: ColoredBox(
        color: AppColors.raised,
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
                    left: pad - 3,
                    top: pad - 3,
                    child: RarityTag(rarity, dense: dense),
                  ),
                  if (labels.isNotEmpty)
                    Positioned(
                      left: pad - 3,
                      bottom: pad - 3,
                      child: Wrap(
                        spacing: 4,
                        children: [for (final l in labels) QuietLabel(l)],
                      ),
                    ),
                ],
              ),
            ),
            Container(
              height: 1,
              color: rarity == Rarity.n
                  ? AppColors.hairline
                  : rarity.color.withValues(alpha: 0.22),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(pad, pad - 2, pad, pad),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    keepAll(name),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: (dense ? AppText.caption : AppText.callout).copyWith(
                      color: AppColors.text,
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                    ),
                  ),
                  if (meta != null || trailing != null) ...[
                    SizedBox(height: dense ? 4 : 6),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        if (meta != null)
                          Expanded(
                            child: Text(
                              meta!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style:
                                  AppText.num(
                                    dense
                                        ? AppText.caption
                                        : AppText.bodyStrong,
                                  ).copyWith(
                                    color: AppColors.text,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -0.4,
                                  ),
                            ),
                          )
                        else
                          const Spacer(),
                        if (trailing != null)
                          RarityPill(rarity, trailing!, dense: dense),
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
