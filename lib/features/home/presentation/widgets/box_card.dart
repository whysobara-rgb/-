import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/theme/rarity_style.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/collectible_card.dart';
import '../../../../shared/widgets/meters.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../../../shared/widgets/ui.dart';
import '../../../gacha/domain/gacha_models.dart';
import '../../../gacha/presentation/widgets/box_thumb.dart';

/// 홈 그리드의 박스 카드.
///
/// 위: 밝은 스튜디오 위 박스 패키지(사진이 있으면 사진) + 서버 배지·천장 +
/// 오른쪽 아래 대표 경품 미니 카드. 아래: 이름, "최대 ~" 경품, 큰 가격,
/// 실재고 막대.
class BoxCard extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;

  const BoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final prize = box.topPrize;
    final dim = box.soldOut;
    return AppCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AspectRatio(
            aspectRatio: 1.0,
            child: Stack(
              fit: StackFit.expand,
              children: [
                BoxThumb(box: box, scale: 0.58, centerY: 0.47),
                if (prize != null)
                  Positioned(
                    right: 8,
                    bottom: 8,
                    width: 44,
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
            padding: const EdgeInsets.fromLTRB(12, 11, 12, 13),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  box.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.headline.copyWith(
                    fontSize: 15,
                    color: dim ? AppColors.textTertiary : AppColors.text,
                  ),
                ),
                const SizedBox(height: 3),
                if (prize != null)
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: '최대 ${formatWonShort(prize.estimatedValue)}',
                          style: TextStyle(
                            color: prize.rarity.ink,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        TextSpan(text: ' · ${prize.name}'),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.num(AppText.caption).copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
                  )
                else
                  Text(
                    box.tagline ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption,
                  ),
                const SizedBox(height: 10),
                PriceText(
                  box.price,
                  size: 20,
                  color: dim ? AppColors.textTertiary : AppColors.text,
                ),
                if (box.totalStock != null && box.soldStock != null) ...[
                  const SizedBox(height: 10),
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
    );
  }
}

/// 대표 경품 미니 카드(박스 그림 위에 얹는다).
class PrizeChip extends StatelessWidget {
  final TopPrize prize;
  final bool holo;
  const PrizeChip({super.key, required this.prize, this.holo = true});

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 0.74,
      child: RarityFrame(
        rarity: prize.rarity,
        holo: holo && prize.rarity == Rarity.ssr,
        holoIntensity: 0.4,
        holoAnimate: false,
        radius: 8,
        glow: 0.9,
        child: ColoredBox(
          color: Colors.white,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: ProductImage(
                  url: prize.imageUrl,
                  rarity: prize.rarity,
                  name: prize.name,
                  borderRadius: BorderRadius.zero,
                ),
              ),
              Container(
                height: 13,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: prize.rarity.foilGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                  ),
                ),
                child: Text(
                  prize.rarity.code,
                  style: AppText.micro.copyWith(
                    color: prize.rarity.onColor,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.8,
                    height: 1,
                  ),
                ),
              ),
            ],
          ),
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
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.all(Radius.circular(5)),
        boxShadow: Shadows.small,
      ),
      child: Center(
        widthFactor: 1,
        child: Text.rich(
          TextSpan(
            children: [
              const TextSpan(
                text: '천장 ',
                style: TextStyle(color: AppColors.textSecondary),
              ),
              TextSpan(text: formatNumber(threshold)),
            ],
          ),
          style: AppText.num(AppText.micro).copyWith(
            color: AppColors.text,
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
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
      color: Colors.white.withValues(alpha: 0.7),
      alignment: Alignment.center,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: const BoxDecoration(
          color: AppColors.text,
          borderRadius: Radii.pill,
        ),
        child: Text(
          'SOLD OUT · 품절',
          style: AppText.micro.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
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
    final ratio = box.soldRatio ?? 0;
    return AppCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Row(
        children: [
          SizedBox(
            width: 104,
            child: BoxThumb(box: box, scale: 0.78, centerY: 0.52),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
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
                      color: AppColors.text,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        '${(ratio * 100).floor()}%',
                        style: AppText.num(AppText.title1).copyWith(
                          color: AppColors.brand,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.8,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '판매',
                        style: AppText.caption.copyWith(
                          color: AppColors.brand,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Spacer(),
                      PriceText(box.price, size: 14),
                    ],
                  ),
                  const SizedBox(height: 6),
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
    );
  }
}

/// 인기 박스: 패키지 타일 + 굵은 순위 숫자 + 누적 오픈 수.
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
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 148,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  borderRadius: Radii.card,
                  boxShadow: Shadows.card,
                ),
                child: ClipRRect(
                  borderRadius: Radii.card,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      BoxThumb(box: box, scale: 0.66, centerY: 0.5),
                      if (prize != null)
                        Positioned(
                          right: 7,
                          bottom: 7,
                          child: RarityPill(
                            prize.rarity,
                            '최대 ${formatWonShort(prize.estimatedValue)}',
                            dense: true,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 26,
                  child: Text(
                    '$rank',
                    style: AppText.num(AppText.display).copyWith(
                      fontSize: 26,
                      height: 1.05,
                      fontWeight: FontWeight.w900,
                      fontStyle: FontStyle.italic,
                      letterSpacing: -1.2,
                      color: rank == 1 ? AppColors.brand : AppColors.text,
                    ),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        box.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong.copyWith(
                          color: AppColors.text,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        '누적 ${formatNumber(drawCount)}회 오픈',
                        style: AppText.num(AppText.caption),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// 박스 바로가기: 작은 패키지 타일 + 짧은 이름(홈 상단 레일).
class BoxShortcut extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;
  const BoxShortcut({super.key, required this.box, required this.onTap});

  /// "그랜드 오픈 기념 박스" → "그랜드 오픈 기념".
  static String shortName(String title) {
    final t = title.replaceAll(RegExp(r'\s*박스$'), '').trim();
    return t.isEmpty ? title : t;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 68,
        child: Column(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                borderRadius: BorderRadius.all(Radius.circular(20)),
                boxShadow: Shadows.small,
              ),
              child: ClipRRect(
                borderRadius: const BorderRadius.all(Radius.circular(20)),
                child: BoxThumb(box: box, scale: 0.7, centerY: 0.53),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              shortName(box.title),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: AppText.caption.copyWith(
                color: AppColors.text,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
