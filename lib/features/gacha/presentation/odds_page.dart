import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/gacha_repository.dart';
import '../domain/gacha_models.dart';

/// 확률 및 구성 정보.
///
/// 확률형 상품 정보 공개 화면. 작은 글씨 각주가 아니라 표와 숫자로
/// 똑바로 보여준다: 등급별·상품별 확률, 천장 규칙과 실질 확률,
/// 10+1 규칙, 포인트 전환율, 1회 기대 가치.
class OddsPage extends StatefulWidget {
  final GachaSummary gacha;
  const OddsPage({super.key, required this.gacha});

  @override
  State<OddsPage> createState() => _OddsPageState();
}

class _OddsPageState extends State<OddsPage> {
  static const _repository = GachaRepository();
  late Future<GachaOdds> _future;

  @override
  void initState() {
    super.initState();
    _future = _repository.odds(widget.gacha.id);
  }

  void _retry() => setState(() => _future = _repository.odds(widget.gacha.id));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('확률 및 구성 정보')),
      body: FutureBuilder<GachaOdds>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingView(height: 400);
          }
          if (snap.hasError || !snap.hasData) {
            final err = snap.error;
            return ErrorView(
              message: err is ApiException
                  ? err.displayMessage
                  : '확률 정보를 불러오지 못했어요',
              onRetry: _retry,
            );
          }
          return _OddsBody(odds: snap.data!);
        },
      ),
    );
  }
}

class _OddsBody extends StatelessWidget {
  final GachaOdds odds;
  const _OddsBody({required this.odds});

  @override
  Widget build(BuildContext context) {
    final pity = odds.pity;
    final ssrBase = odds.rarities
        .where((r) => r.rarity.code == 'SSR')
        .fold<double>(0, (s, r) => s + r.probabilityPercent);
    final totalPercent = odds.rarities.fold<double>(
      0,
      (s, r) => s + r.probabilityPercent,
    );

    return ListView(
      padding: const EdgeInsets.only(bottom: Space.x10),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x2,
            Space.gutter,
            Space.x5,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(odds.title, style: AppText.title1),
              const SizedBox(height: Space.x1),
              Text(
                '1회 ${formatGp(odds.price)}',
                style: AppText.num(AppText.callout),
              ),
            ],
          ),
        ),

        // 핵심 수치 2×2.
        Padding(
          padding: Space.page,
          child: _FigureGrid(
            figures: [
              _Figure(
                'SSR 기본 확률',
                formatPercent(pity?.baseRatePercent ?? ssrBase),
              ),
              if (pity != null)
                _Figure(
                  '천장 반영 SSR 확률',
                  formatPercent(pity.effectiveRatePercent),
                )
              else
                _Figure('천장', '없음'),
              _Figure(
                '1회 기대 가치',
                formatWon(
                  pity != null
                      ? odds.expectedValueWithPity
                      : odds.expectedValuePerDraw,
                ),
                sub: '상품 정가 기준 평균',
              ),
              _Figure(
                '정가 환급률',
                '${formatPercent(odds.payoutSinglePercent, maxDecimals: 1)} / ${formatPercent(odds.payoutMultiPercent, maxDecimals: 1)}',
                sub: '1회 / 10+1회',
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.x6),
        const SectionBand(),

        // 등급별.
        const SectionHeader(title: '등급별 확률'),
        Padding(
          padding: Space.page,
          child: _Table(
            columns: const ['등급', '상품 수', '확률'],
            flex: const [3, 2, 3],
            rows: [
              for (final r in odds.rarities)
                [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: RarityTag(r.rarity),
                  ),
                  Text(
                    '${r.itemCount}종',
                    textAlign: TextAlign.right,
                    style: AppText.num(AppText.body),
                  ),
                  Text(
                    formatPercent(r.probabilityPercent),
                    textAlign: TextAlign.right,
                    style: AppText.num(AppText.bodyStrong),
                  ),
                ],
            ],
            footer: [
              Text('합계', style: AppText.bodyStrong),
              Text(
                '${odds.items.length}종',
                textAlign: TextAlign.right,
                style: AppText.num(AppText.body),
              ),
              Text(
                formatPercent(totalPercent, maxDecimals: 2),
                textAlign: TextAlign.right,
                style: AppText.num(AppText.bodyStrong),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.x6),
        const SectionBand(),

        // 상품별.
        const SectionHeader(title: '상품별 확률', subtitle: '정가 · 포인트 전환 시 받는 GP'),
        for (var i = 0; i < odds.items.length; i++) ...[
          if (i > 0) const Hairline(inset: Space.gutter),
          _ItemOddsRow(item: odds.items[i]),
        ],
        const SizedBox(height: Space.x4),
        const SectionBand(),

        // 규칙.
        const SectionHeader(title: '확률에 영향을 주는 규칙'),
        Padding(
          padding: Space.page,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RuleBlock(
                title: '천장',
                body: pity == null
                    ? '이 박스에는 천장이 없어요. 매 회차가 위 확률로 독립적으로 뽑혀요.'
                    : '이 박스에서 SSR 없이 ${pity.threshold}회째가 되면 그 회차는 SSR로 확정돼요. '
                          'SSR을 받으면(천장·일반 모두) 다시 0회부터 셉니다. 진행 횟수는 박스마다 따로 셉니다.',
                rows: pity == null
                    ? const []
                    : [
                        InfoRow(
                          label: '천장 횟수',
                          value: '${formatNumber(pity.threshold)}회',
                        ),
                        InfoRow(
                          label: 'SSR 기본 확률',
                          value: formatPercent(pity.baseRatePercent),
                        ),
                        InfoRow(
                          label: '천장 반영 확률',
                          value: formatPercent(pity.effectiveRatePercent),
                        ),
                        InfoRow(
                          label: 'SSR까지 평균',
                          value:
                              '${pity.expectedDrawsToHit.toStringAsFixed(1)}회',
                        ),
                      ],
              ),
              const SizedBox(height: Space.x5),
              _RuleBlock(
                title: '${odds.bonusEvery}+${odds.bonusCount} 보너스',
                body:
                    '한 번에 ${odds.bonusEvery}회를 뽑으면 ${odds.bonusCount}회를 더 뽑아요. '
                    '보너스 회차도 위와 같은 확률로 뽑고, 천장 횟수에도 포함돼요.',
                rows: [
                  InfoRow(
                    label: '1회 환급률',
                    value: formatPercent(
                      odds.payoutSinglePercent,
                      maxDecimals: 1,
                    ),
                  ),
                  InfoRow(
                    label: '10+1 환급률',
                    value: formatPercent(
                      odds.payoutMultiPercent,
                      maxDecimals: 1,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Space.x5),
              _RuleBlock(
                title: '포인트 전환',
                body:
                    '받은 상품은 정가의 ${formatPercent(odds.exchangeRatePercent, maxDecimals: 1)}를 GP로 전환할 수 있어요. '
                    '전환한 상품은 되돌릴 수 없어요.',
              ),
              const SizedBox(height: Space.x5),
              _RuleBlock(
                title: '기대 가치',
                body: '1회 뽑기에서 받는 상품 정가의 평균이에요. 실제 결과는 회차마다 달라요.',
                rows: [
                  InfoRow(
                    label: '확률만 반영',
                    value: formatWon(odds.expectedValuePerDraw),
                  ),
                  if (pity != null)
                    InfoRow(
                      label: '천장까지 반영',
                      value: formatWon(odds.expectedValueWithPity),
                    ),
                  InfoRow(label: '1회 가격', value: formatGp(odds.price)),
                ],
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x6,
            Space.gutter,
            0,
          ),
          child: Text(
            keepAll(
              '표시된 확률은 서버 추첨에 쓰는 가중치를 그대로 환산한 값이며, 소수점 넷째 자리까지 보여드려요. '
              '설정이 바뀌면 이 화면에 바로 반영돼요.',
            ),
            style: AppText.caption.copyWith(color: AppColors.textTertiary),
          ),
        ),
      ],
    );
  }
}

class _Figure {
  final String label;
  final String value;
  final String? sub;
  const _Figure(this.label, this.value, {this.sub});
}

class _FigureGrid extends StatelessWidget {
  final List<_Figure> figures;
  const _FigureGrid({required this.figures});

  @override
  Widget build(BuildContext context) {
    Widget cell(_Figure f) => Padding(
      padding: const EdgeInsets.all(Space.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(f.label, style: AppText.caption),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(f.value, style: AppText.num(AppText.title2)),
          ),
          if (f.sub != null) ...[
            const SizedBox(height: 2),
            Text(
              f.sub!,
              style: AppText.micro.copyWith(
                color: AppColors.textTertiary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ],
      ),
    );

    final rows = <Widget>[];
    for (var i = 0; i < figures.length; i += 2) {
      if (i > 0) rows.add(const Divider(height: 1));
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: cell(figures[i])),
              const VerticalDivider(
                width: 1,
                thickness: 1,
                color: AppColors.hairline,
              ),
              Expanded(
                child: i + 1 < figures.length
                    ? cell(figures[i + 1])
                    : const SizedBox(),
              ),
            ],
          ),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.hairline),
        borderRadius: Radii.card,
      ),
      child: Column(children: rows),
    );
  }
}

class _Table extends StatelessWidget {
  final List<String> columns;
  final List<int> flex;
  final List<List<Widget>> rows;
  final List<Widget>? footer;

  const _Table({
    required this.columns,
    required this.flex,
    required this.rows,
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    Widget row(
      List<Widget> cells, {
      EdgeInsets padding = const EdgeInsets.symmetric(vertical: 12),
    }) => Padding(
      padding: padding,
      child: Row(
        children: [
          for (var i = 0; i < cells.length; i++)
            Expanded(flex: flex[i], child: cells[i]),
        ],
      ),
    );

    return Column(
      children: [
        Container(
          decoration: const BoxDecoration(
            border: Border(
              top: BorderSide(color: AppColors.text),
              bottom: BorderSide(color: AppColors.hairline),
            ),
          ),
          child: row([
            for (var i = 0; i < columns.length; i++)
              Text(
                columns[i],
                textAlign: i == 0 ? TextAlign.left : TextAlign.right,
                style: AppText.caption,
              ),
          ], padding: const EdgeInsets.symmetric(vertical: 9)),
        ),
        for (var i = 0; i < rows.length; i++) ...[
          if (i > 0) const Hairline(),
          row(rows[i]),
        ],
        if (footer != null)
          Container(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(
                top: BorderSide(color: AppColors.hairline),
                bottom: BorderSide(color: AppColors.hairline),
              ),
            ),
            child: row(
              footer!,
              padding: const EdgeInsets.symmetric(vertical: 10),
            ),
          ),
      ],
    );
  }
}

class _ItemOddsRow extends StatelessWidget {
  final LineupItem item;
  const _ItemOddsRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.gutter,
        vertical: Space.x3,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 48,
            height: 48,
            child: ProductImage(url: item.imageUrl),
          ),
          const SizedBox(width: Space.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    RarityTag(item.rarity, dense: true),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        item.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  item.exchangeValue != null
                      ? '${formatWon(item.estimatedValue)} · ${formatGp(item.exchangeValue!)}'
                      : formatWon(item.estimatedValue),
                  style: AppText.num(AppText.caption),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.x3),
          Text(
            formatPercent(item.probabilityPercent),
            style: AppText.num(AppText.bodyStrong),
          ),
        ],
      ),
    );
  }
}

class _RuleBlock extends StatelessWidget {
  final String title;
  final String body;
  final List<Widget> rows;

  const _RuleBlock({
    required this.title,
    required this.body,
    this.rows = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: AppText.headline),
        const SizedBox(height: Space.x1),
        Text(keepAll(body), style: AppText.callout),
        if (rows.isNotEmpty) ...[
          const SizedBox(height: Space.x2),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Space.x4,
              vertical: Space.x1,
            ),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: Radii.card,
            ),
            child: Column(children: rows),
          ),
        ],
      ],
    );
  }
}
