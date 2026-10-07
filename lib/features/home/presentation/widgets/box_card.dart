import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/collectible_card.dart';
import '../../../../shared/widgets/meters.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../../gacha/domain/gacha_models.dart';

/// 홈 그리드의 박스 카드(수집품 느낌).
///
/// 박스 아트 위에 서버 배지, 오른쪽 아래에 대표 경품 미니 카드(레어도 프레임,
/// SSR은 홀로), 아래에 이름·대표 경품·가격·실재고 막대.
class BoxCard extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;

  const BoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final prize = box.topPrize;
    final dim = box.soldOut;
    return Material(
      color: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: Radii.card,
        side: BorderSide(color: AppColors.hairline),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 1.08,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  BoxImage(
                    url: box.imageUrl,
                    tone: box.accent ?? AppColors.brand,
                    category: box.category,
                    borderRadius: BorderRadius.zero,
                    artScale: 0.34,
                    artCenterY: 0.46,
                  ),
                  if (prize != null)
                    Positioned(
                      right: 8,
                      bottom: 8,
                      width: 50,
                      child: PrizeChip(prize: prize),
                    ),
                  Positioned(
                    left: 8,
                    top: 8,
                    right: 8,
                    child: Row(
                      children: [
                        if (box.badgeLabel != null && !dim)
                          BoxBadge(box.badgeLabel!),
                        const Spacer(),
                        if (box.pityThreshold != null && !dim)
                          _PityChip(threshold: box.pityThreshold!),
                      ],
                    ),
                  ),
                  if (dim) const _SoldOutVeil(),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(11, 10, 11, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    box.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.bodyStrong.copyWith(
                      color: dim ? AppColors.textTertiary : AppColors.text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  if (prize != null)
                    Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: '최대 '),
                          TextSpan(
                            text: formatWonShort(prize.estimatedValue),
                            style: TextStyle(
                              color: prize.rarity.light,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          TextSpan(text: ' · ${prize.name}'),
                        ],
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.num(AppText.micro).copyWith(
                        color: AppColors.textSecondary,
                        fontWeight: FontWeight.w500,
                      ),
                    )
                  else
                    Text(
                      box.tagline ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.micro,
                    ),
                  const SizedBox(height: 9),
                  Text(
                    formatGp(box.price),
                    style: AppText.num(AppText.headline).copyWith(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: dim ? AppColors.textTertiary : AppColors.text,
                    ),
                  ),
                  if (box.totalStock != null && box.soldStock != null) ...[
                    const SizedBox(height: 8),
                    StockBar(
                      total: box.totalStock!,
                      sold: box.soldStock!,
                      soldOut: box.soldOut,
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

/// 대표 경품 미니 카드(박스 아트 위에 얹는다).
class PrizeChip extends StatelessWidget {
  final TopPrize prize;
  final bool holo;
  const PrizeChip({super.key, required this.prize, this.holo = true});

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 0.72,
      child: RarityFrame(
        rarity: prize.rarity,
        holo: holo && prize.rarity == Rarity.ssr,
        holoIntensity: 0.4,
        holoAnimate: false,
        radius: 7,
        glow: 0.8,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ProductImage(
              url: prize.imageUrl,
              rarity: prize.rarity,
              name: prize.name,
              borderRadius: BorderRadius.zero,
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: Colors.black.withValues(alpha: 0.55),
                padding: const EdgeInsets.symmetric(vertical: 2),
                alignment: Alignment.center,
                child: Text(
                  prize.rarity.code,
                  style: AppText.micro.copyWith(
                    color: prize.rarity.light,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.8,
                    height: 1.1,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PityChip extends StatelessWidget {
  final int threshold;
  const _PityChip({required this.threshold});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: Radii.chip,
        border: Border.all(color: AppColors.raritySSR.withValues(alpha: 0.4)),
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          '천장 ${formatNumber(threshold)}',
          style: AppText.num(AppText.micro).copyWith(
            color: AppColors.raritySSRLight,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            height: 1,
          ),
        ),
      ),
    );
  }
}

class _SoldOutVeil extends StatelessWidget {
  const _SoldOutVeil();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black.withValues(alpha: 0.6),
      alignment: Alignment.center,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: Colors.white.withValues(alpha: 0.5)),
          borderRadius: Radii.chip,
        ),
        child: Text(
          'SOLD OUT · 품절',
          style: AppText.micro.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.8,
          ),
        ),
      ),
    );
  }
}

/// 마감 임박 가로 카드: 실재고 70% 이상 판매된 박스.
class EndingSoonCard extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;
  const EndingSoonCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.card,
        side: BorderSide(color: AppColors.danger.withValues(alpha: 0.35)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            SizedBox(
              width: 96,
              child: BoxImage(
                url: box.imageUrl,
                tone: box.accent ?? AppColors.brand,
                category: box.category,
                borderRadius: BorderRadius.zero,
                artScale: 0.5,
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      box.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      formatGp(box.price),
                      style: AppText.num(AppText.caption).copyWith(
                        color: AppColors.text,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    StockBar(
                      total: box.totalStock ?? 0,
                      sold: box.soldStock ?? 0,
                      soldOut: box.soldOut,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 인기 박스: 큰 순위 숫자 위에 박스 카드가 겹친다.
class PopularRankCard extends StatelessWidget {
  final int rank;
  final GachaSummary box;
  final int drawCount;
  final VoidCallback onTap;

  const PopularRankCard({
    super.key,
    required this.rank,
    required this.box,
    required this.drawCount,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final prize = box.topPrize;
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 176,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: -4,
              bottom: 34,
              child: Text(
                '$rank',
                style: TextStyle(
                  fontFamily: AppText.family,
                  fontSize: 104,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -8,
                  foreground: Paint()
                    ..style = PaintingStyle.stroke
                    ..strokeWidth = 1.6
                    ..color = rank == 1
                        ? AppColors.raritySSR.withValues(alpha: 0.9)
                        : AppColors.hairlineStrong,
                ),
              ),
            ),
            Positioned(
              left: 50,
              top: 0,
              right: 0,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AspectRatio(
                    aspectRatio: 0.8,
                    child: ClipRRect(
                      borderRadius: Radii.thumb,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          BoxImage(
                            url: box.imageUrl,
                            tone: box.accent ?? AppColors.brand,
                            category: box.category,
                            borderRadius: BorderRadius.zero,
                            artScale: 0.42,
                          ),
                          if (prize != null)
                            Positioned(
                              left: 6,
                              bottom: 6,
                              child: RarityTag(prize.rarity, dense: true),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    box.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption.copyWith(
                      color: AppColors.text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    '누적 ${formatNumber(drawCount)}회 오픈',
                    style: AppText.num(
                      AppText.micro,
                    ).copyWith(color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
