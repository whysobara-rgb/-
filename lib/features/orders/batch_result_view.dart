import 'package:flutter/material.dart';
import '../../shared/widgets/gachi_components.dart';
import '../../shared/widgets/gachi_opening.dart';
import 'batch_opening.dart';
import 'order_models.dart';
import 'prize_reveal.dart';

/// Read-only rendering of the existing durable batch. No state is persisted here.
class BatchResultView extends StatelessWidget {
  final BatchOpening batch;
  final bool working, continuing;
  final String grade;
  final String? error;
  final ValueChanged<String> onGrade;
  final VoidCallback? onStop, onResume, onClose, onCollection;
  const BatchResultView({
    super.key,
    required this.batch,
    required this.working,
    required this.continuing,
    required this.grade,
    required this.onGrade,
    this.error,
    this.onStop,
    this.onResume,
    this.onClose,
    this.onCollection,
  });

  @override
  Widget build(BuildContext context) {
    final b = batch;
    final pending = b.inFlight != null || (working && !b.complete) ? 1 : 0;
    final unopened = b.remaining - pending;
    final groups = <String, List<Opening>>{};
    for (final r in b.results) {
      if (grade != '전체' && r.prize.displayGrade != grade) continue;
      final p = r.prize;
      final key = '${p.itemId}/${p.rarity}/${p.name}/${p.conversionGP}';
      groups.putIfAbsent(key, () => []).add(r);
    }
    final result = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!b.complete)
          GachiOpeningBreakdown(
            completed: b.results.length,
            pending: pending,
            unopened: unopened,
          ),
        const SizedBox(height: GachiSpace.lg),
        if (error != null)
          Semantics(
            liveRegion: true,
            child: Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (!working && !b.complete) ...[
          const SizedBox(height: GachiSpace.md),
          Text(
            pending > 0
                ? '처리 중인 결과를 먼저 확인합니다. 아직 미개봉인 박스는 그대로 보관돼요.'
                : b.results.isEmpty
                ? '아직 개봉된 박스가 없습니다. 선택한 박스는 미개봉으로 보관돼요.'
                : '확인된 상품은 보관함에 저장됐어요. 남은 박스는 미개봉으로 보관돼요.',
          ),
          const SizedBox(height: GachiSpace.md),
          GachiSecondaryButton(
            onPressed: onResume,
            label: b.inFlight == null ? '남은 박스 이어서 개봉' : '처리 중인 결과 확인 후 이어가기',
          ),
        ],
        if (b.results.isNotEmpty) ...[
          const SizedBox(height: GachiSpace.lg),
          if (b.results.map((r) => r.prize.displayGrade).toSet().length > 1)
            Wrap(
              spacing: GachiSpace.sm,
              runSpacing: GachiSpace.sm,
              children:
                  ['전체', ...b.results.map((r) => r.prize.displayGrade).toSet()]
                      .map(
                        (g) => ChoiceChip(
                          label: Text(
                            '$g ${g == '전체' ? b.results.length : b.results.where((r) => r.prize.displayGrade == g).length}',
                            style: TextStyle(
                              color: g == grade
                                  ? GachiColors.ivory
                                  : GachiColors.ink,
                            ),
                          ),
                          selected: grade == g,
                          onSelected: (_) => onGrade(g),
                        ),
                      )
                      .toList(),
            ),
          GachiResultGroups(groups: groups.values.toList()),
          const SizedBox(height: GachiSpace.md),
          GachiPrimaryButton(
            label: '보관함 보기',
            onPressed: onCollection,
            gold: true,
          ),
        ],
        if (!working && b.inFlight == null) ...[
          const SizedBox(height: GachiSpace.md),
          GachiSecondaryButton(
            onPressed: onClose,
            label: b.complete ? '결과 확인 완료' : '여기까지 확인하고 나머지는 보관하기',
          ),
        ],
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GachiOpeningHeading(
          title: b.complete
              ? '${b.results.length}개 개봉 완료'
              : working
              ? '박스를 열고 있어요'
              : b.results.isEmpty
              ? '개봉 상태 확인'
              : '${b.results.length}개 개봉 완료',
          description: b.complete
              ? '확인된 상품은 내 보관함에 저장됐어요.'
              : '${b.results.length} / ${b.capsuleIds.length}개 확인 · 추가 결제 0 GP',
        ),
        if (!working && b.results.isEmpty)
          result
        else
          GachiOpeningExperience(waiting: working, result: result),
        if (working) ...[
          const SizedBox(height: GachiSpace.md),
          Text(
            continuing ? '앱을 닫아도 확인된 결과는 보관함에 남아요.' : '현재 박스의 결과를 확인한 뒤 멈춥니다.',
            style: GachiType.meta.copyWith(color: GachiOpeningColors.secondary),
          ),
          TextButton(
            onPressed: continuing ? onStop : null,
            child: const Text('현재 박스까지 열고 멈추기'),
          ),
        ],
      ],
    );
  }
}

/// Presentation-only disclosure; all confirmed results remain in the batch.
class GachiResultGroups extends StatelessWidget {
  final List<List<Opening>> groups;
  const GachiResultGroups({super.key, required this.groups});

  Widget _group(List<Opening> group) => groups.length == 1
      ? PrizeReveal(
          animate: false,
          prize: group.first.prize,
          quantity: group.length,
        )
      : GachiConfirmedResultRow(
          prize: group.first.prize,
          quantity: group.length,
        );

  @override
  Widget build(BuildContext context) {
    final limit = MediaQuery.textScalerOf(context).scale(15) > 21 ? 1 : 3;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final group in groups.take(limit)) _group(group),
        if (groups.length > limit)
          TextButton(
            key: const Key('result-groups-toggle'),
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              backgroundColor: GachiOpeningColors.panel,
              builder: (_) => GachiOpeningTheme(
                child: FractionallySizedBox(
                  heightFactor: .9,
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(GachiSpace.lg),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '확정 상품 ${groups.length}종',
                                style: GachiType.section.copyWith(
                                  color: GachiColors.ivory,
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: '상품 목록 닫기',
                              onPressed: () => Navigator.pop(context),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: ListView.builder(
                          key: const Key('all-confirmed-results'),
                          padding: const EdgeInsets.all(GachiSpace.lg),
                          itemCount: groups.length,
                          itemBuilder: (_, i) => _group(groups[i]),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            child: Text('확정 상품 ${groups.length}종 모두 보기'),
          ),
      ],
    );
  }
}

/// Compact multi-result presentation; values are confirmed server prizes only.
class GachiConfirmedResultRow extends StatelessWidget {
  final Prize prize;
  final int quantity;
  const GachiConfirmedResultRow({
    super.key,
    required this.prize,
    required this.quantity,
  });
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(GachiSpace.md),
    margin: const EdgeInsets.symmetric(vertical: GachiSpace.xs),
    decoration: BoxDecoration(
      color: GachiOpeningColors.panel,
      borderRadius: GachiShape.card,
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 64,
          child: GachiProductImage(
            url: prize.imageUrl,
            label: prize.name,
            compact: true,
          ),
        ),
        const SizedBox(width: GachiSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                prize.name,
                style: GachiType.product.copyWith(color: GachiColors.ivory),
              ),
              Text(
                '${prize.displayGrade} · × $quantity',
                style: GachiType.meta.copyWith(
                  color: GachiOpeningColors.secondary,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
