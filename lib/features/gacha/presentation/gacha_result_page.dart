import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../../inventory/data/inventory_repository.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_models.dart';
import 'widgets/pity_bar.dart';

/// 뽑기 결과.
///
/// 결과는 서버에서 이미 보관함에 담긴 상태다. 기본 동작은 "보관함에 보관"
/// (그대로 두기)이고, 원하면 그 자리에서 정가의 80%를 GP로 전환할 수 있다.
class GachaResultPage extends StatefulWidget {
  final GachaSummary gacha;
  final DrawOutcome outcome;

  const GachaResultPage({
    super.key,
    required this.gacha,
    required this.outcome,
  });

  @override
  State<GachaResultPage> createState() => _GachaResultPageState();
}

class _GachaResultPageState extends State<GachaResultPage> {
  static const _inventory = InventoryRepository();
  bool _exchanging = false;
  bool _exchanged = false;

  DrawOutcome get _o => widget.outcome;

  void _keep() {
    final count = _o.results.length;
    final tabs = context.read<TabNavigator>();
    final messenger = ScaffoldMessenger.of(context);
    Navigator.of(context).pop();
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('보관함에 $count개를 담았어요'),
          action: SnackBarAction(
            label: '보관함 보기',
            onPressed: () => tabs.select(AppTab.inventory),
          ),
        ),
      );
  }

  Future<void> _confirmExchange() async {
    final ids = _o.inventoryItemIds;
    final total = _o.totalExchange;
    if (ids.isEmpty || total <= 0) return;
    final balance = context.read<GpProvider>().balance;

    final ok = await showAppSheet<bool>(
      context: context,
      title: '포인트로 전환',
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          0,
          Space.gutter,
          Space.x4,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '이번에 받은 상품 ${ids.length}개를 정가의 80%로 전환해요.',
              style: AppText.callout,
            ),
            const SizedBox(height: Space.x4),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: Space.x4,
                vertical: Space.x2,
              ),
              decoration: const BoxDecoration(
                color: AppColors.bgSubtle,
                borderRadius: Radii.card,
              ),
              child: Column(
                children: [
                  InfoRow(label: '상품 정가 합계', value: formatWon(_o.totalValue)),
                  InfoRow(
                    label: '받는 GP',
                    value: formatGp(total),
                    valueStyle: AppText.num(
                      AppText.headline,
                    ).copyWith(color: AppColors.accent),
                  ),
                  const Hairline(),
                  InfoRow(label: '전환 후 보유', value: formatGp(balance + total)),
                ],
              ),
            ),
            const SizedBox(height: Space.x3),
            Text('전환한 상품은 보관함에서 사라지고 되돌릴 수 없어요.', style: AppText.caption),
            const SizedBox(height: Space.x5),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheet).pop(false),
                    child: const Text('취소'),
                  ),
                ),
                const SizedBox(width: Space.x2),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () => Navigator.of(sheet).pop(true),
                    child: Text('${formatGp(total)} 받기'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _exchanging = true);
    try {
      final result = await _inventory.exchange(ids);
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      if (result.balanceAfter != null) {
        auth.applyBalance(result.balanceAfter!);
      } else {
        await auth.refreshProfile();
      }
      if (!mounted) return;
      setState(() => _exchanged = true);
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).pop();
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text('${formatGp(result.totalGp)}를 받았어요')),
        );
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _exchanging = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sorted = _o.sortedResults;
    final best = sorted.isEmpty ? null : sorted.first;
    final isSingle = sorted.length == 1;
    final canExchange =
        !_exchanged && _o.totalExchange > 0 && _o.inventoryItemIds.isNotEmpty;

    return PopScope(
      canPop: !_exchanging,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text('뽑기 결과'),
          actions: [
            IconButton(
              tooltip: '닫기',
              onPressed: _exchanging ? null : _keep,
              icon: const Icon(Icons.close),
            ),
            const SizedBox(width: Space.x1),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.only(bottom: Space.x8),
          children: [
            _Summary(gacha: widget.gacha, outcome: _o),
            const SectionBand(),
            if (isSingle && best != null)
              _SingleResult(result: best)
            else
              _ResultGrid(results: sorted),
            if (_o.pity?.hasPity ?? false) ...[
              const SectionBand(),
              _PityLine(pity: _o.pity!),
            ],
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                Space.x5,
                Space.gutter,
                0,
              ),
              child: Text(
                '보관한 상품은 보관함에서 언제든 배송 신청하거나 포인트로 전환할 수 있어요.',
                style: AppText.caption.copyWith(color: AppColors.inkTertiary),
              ),
            ),
          ],
        ),
        bottomNavigationBar: _BottomActions(
          exchangeLabel: canExchange
              ? '포인트 전환 · ${formatGp(_o.totalExchange)}'
              : null,
          exchanging: _exchanging,
          onExchange: _confirmExchange,
          onKeep: _keep,
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  final GachaSummary gacha;
  final DrawOutcome outcome;

  const _Summary({required this.gacha, required this.outcome});

  @override
  Widget build(BuildContext context) {
    final counts = <Rarity, int>{};
    for (final r in outcome.results) {
      counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
    }
    final drawLabel = outcome.bonusCount > 0
        ? '${outcome.count}+${outcome.bonusCount}회'
        : '${outcome.count}회';

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x2,
        Space.gutter,
        Space.x5,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${gacha.title} · $drawLabel', style: AppText.callout),
          const SizedBox(height: Space.x1),
          Text('${outcome.results.length}개를 받았어요', style: AppText.title1),
          const SizedBox(height: Space.x3),
          Wrap(
            spacing: Space.x3,
            runSpacing: Space.x2,
            children: [
              for (final rarity in Rarity.values.reversed)
                if ((counts[rarity] ?? 0) > 0)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      RarityTag(rarity),
                      const SizedBox(width: 4),
                      Text(
                        '${counts[rarity]}',
                        style: AppText.num(AppText.bodyStrong),
                      ),
                    ],
                  ),
            ],
          ),
          const SizedBox(height: Space.x4),
          InfoRow(label: '사용', value: formatGp(outcome.spent)),
          InfoRow(label: '받은 상품 정가', value: formatWon(outcome.totalValue)),
          if (outcome.totalExchange > 0)
            InfoRow(
              label: '포인트 전환 시',
              value: formatGp(outcome.totalExchange),
              valueStyle: AppText.num(
                AppText.bodyStrong,
              ).copyWith(color: AppColors.inkSecondary),
            ),
        ],
      ),
    );
  }
}

class _SingleResult extends StatelessWidget {
  final DrawResult result;
  const _SingleResult({required this.result});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        Space.x5,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: Radii.card,
                border: Border.all(
                  color: result.rarity.color.withValues(alpha: 0.5),
                  width: 1.5,
                ),
              ),
              padding: const EdgeInsets.all(1.5),
              child: ProductImage(
                url: result.imageUrl,
                borderRadius: Radii.thumb,
              ),
            ),
          ),
          const SizedBox(height: Space.x4),
          Row(
            children: [
              RarityTag(result.rarity),
              if (result.isPity) ...[
                const SizedBox(width: 4),
                const QuietLabel('천장'),
              ],
              if (result.isBonus) ...[
                const SizedBox(width: 4),
                const QuietLabel('보너스'),
              ],
            ],
          ),
          const SizedBox(height: Space.x2),
          Text(result.name, style: AppText.title2),
          const SizedBox(height: Space.x1),
          Text(
            result.exchangeValue > 0
                ? '정가 ${formatWon(result.estimatedValue)} · 전환 시 ${formatGp(result.exchangeValue)}'
                : '정가 ${formatWon(result.estimatedValue)}',
            style: AppText.num(AppText.callout),
          ),
        ],
      ),
    );
  }
}

class _ResultGrid extends StatelessWidget {
  final List<DrawResult> results;
  const _ResultGrid({required this.results});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        Space.x2,
      ),
      child: LayoutBuilder(
        builder: (context, c) {
          const columns = 3;
          const gap = Space.x3;
          final w = (c.maxWidth - gap * (columns - 1)) / columns;
          return Wrap(
            spacing: gap,
            runSpacing: Space.x4,
            children: [
              for (final r in results)
                SizedBox(
                  width: w,
                  child: _ResultTile(result: r),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _ResultTile extends StatelessWidget {
  final DrawResult result;
  const _ResultTile({required this.result});

  @override
  Widget build(BuildContext context) {
    final highlight = result.rarity.rank >= Rarity.sr.rank;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: Radii.thumb,
              border: highlight
                  ? Border.all(
                      color: result.rarity.color.withValues(alpha: 0.7),
                      width: 1.5,
                    )
                  : null,
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                ProductImage(url: result.imageUrl),
                Positioned(
                  left: 6,
                  top: 6,
                  child: RarityTag(result.rarity, solid: true, dense: true),
                ),
                if (result.isPity || result.isBonus)
                  Positioned(
                    left: 6,
                    bottom: 6,
                    child: QuietLabel(result.isPity ? '천장' : '보너스'),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: Space.x2),
        Text(
          result.name,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppText.caption.copyWith(color: AppColors.ink, height: 1.35),
        ),
        const SizedBox(height: 2),
        Text(
          formatWon(result.estimatedValue),
          style: AppText.num(
            AppText.caption,
          ).copyWith(fontWeight: FontWeight.w700, color: AppColors.ink),
        ),
      ],
    );
  }
}

class _PityLine extends StatelessWidget {
  final PityStatus pity;
  const _PityLine({required this.pity});

  @override
  Widget build(BuildContext context) {
    final remaining = pity.remaining ?? 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        Space.x2,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('천장', style: AppText.bodyStrong),
              const Spacer(),
              Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(text: 'SSR 확정까지 '),
                    TextSpan(
                      text: '$remaining회',
                      style: AppText.num(
                        AppText.bodyStrong,
                      ).copyWith(color: AppColors.ink),
                    ),
                  ],
                ),
                style: AppText.callout,
              ),
            ],
          ),
          const SizedBox(height: Space.x2),
          PityBar(progress: pity.progress),
          const SizedBox(height: Space.x2),
          Text(
            '${formatNumber(pity.drawsSinceTopTier)} / ${formatNumber(pity.threshold ?? 0)}회',
            style: AppText.num(AppText.caption),
          ),
        ],
      ),
    );
  }
}

class _BottomActions extends StatelessWidget {
  final String? exchangeLabel;
  final bool exchanging;
  final VoidCallback onExchange;
  final VoidCallback onKeep;

  const _BottomActions({
    required this.exchangeLabel,
    required this.exchanging,
    required this.onExchange,
    required this.onKeep,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.bg,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x3,
            Space.gutter,
            Space.x3,
          ),
          child: Row(
            children: [
              if (exchangeLabel != null) ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: exchanging ? null : onExchange,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    child: exchanging
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : FittedBox(
                            child: Text(
                              exchangeLabel!,
                              style: AppText.num(AppText.headline),
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: Space.x2),
              ],
              Expanded(
                child: FilledButton(
                  onPressed: exchanging ? null : onKeep,
                  child: const Text('보관함에 보관'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
