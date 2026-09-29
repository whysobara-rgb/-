import 'package:flutter/material.dart';
import 'gachi_components.dart';

/// Brand artwork, never a stand-in for a prize or a catalogue photograph.
class GachiDiscoveryHero extends StatelessWidget {
  final VoidCallback onExplore;
  const GachiDiscoveryHero({super.key, required this.onExplore});

  @override
  Widget build(BuildContext context) => Container(
    clipBehavior: Clip.antiAlias,
    decoration: const BoxDecoration(
      color: GachiColors.navy,
      borderRadius: GachiShape.card,
    ),
    child: Stack(
      children: [
        Positioned(
          right: -42,
          top: -32,
          child: ExcludeSemantics(
            child: Opacity(
              opacity: .22,
              child: Image.asset(
                'assets/images/brand/gachi-orb.webp',
                width: 210,
                height: 210,
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(GachiSpace.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'GACHI DISCOVERY',
                style: GachiType.english.copyWith(color: GachiColors.gold),
              ),
              const SizedBox(height: GachiSpace.lg),
              Text(
                '일상을 여는\n새로운 발견',
                style: GachiType.display.copyWith(color: GachiColors.ivory),
              ),
              const SizedBox(height: GachiSpace.md),
              Text(
                '구성 상품과 확률을 살펴보고,\n나의 박스를 골라보세요.',
                style: GachiType.body.copyWith(color: GachiColors.ivory),
              ),
              const SizedBox(height: GachiSpace.xl),
              GachiPrimaryButton(
                label: '박스 둘러보기',
                onPressed: onExplore,
                gold: true,
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
