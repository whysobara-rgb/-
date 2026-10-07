import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/gacha_repository.dart';
import '../domain/gacha_models.dart';
import 'gacha_animation_page.dart';
import 'odds_page.dart';
import 'widgets/pity_bar.dart';

/// 박스 상세.
///
/// 상품 사진 → 가격 → 내 천장 진행 → 등급별 확률 → 구성 상품 → 이용 안내
/// 순서로, 사기 전에 알아야 할 것을 모두 한 화면에 둔다.
/// 하단 CTA는 "1회 뽑기"와 "10+1회 뽑기" 두 개뿐이다.
class GachaDetailPage extends StatefulWidget {
  final GachaSummary gacha;

  const GachaDetailPage({super.key, required this.gacha});

  @override
  State<GachaDetailPage> createState() => _GachaDetailPageState();
}

class _GachaDetailPageState extends State<GachaDetailPage> {
  static const _repository = GachaRepository();

  GachaDetail? _detail;
  PityStatus? _pity;
  bool _loading = true;
  String? _error;

  /// 사진을 지나 스크롤하면 앱바에 박스명을 보여준다.
  final _scroll = ScrollController();
  bool _showTitle = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      final show =
          _scroll.hasClients &&
          _scroll.offset > MediaQuery.sizeOf(context).width * 0.9;
      if (show != _showTitle) setState(() => _showTitle = show);
    });
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _detail == null;
      _error = null;
    });
    try {
      final detail = await _repository.detail(widget.gacha.id);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.displayMessage;
        _loading = false;
      });
    }
    _loadPity();
  }

  Future<void> _loadPity() async {
    try {
      final pity = await _repository.pity(widget.gacha.id);
      if (mounted) setState(() => _pity = pity);
    } catch (_) {
      // 구버전 서버 등: 천장 표시만 생략한다.
    }
  }

  GachaSummary get _summary {
    final d = _detail;
    if (d == null) return widget.gacha;
    return GachaSummary(
      id: d.id,
      title: d.title,
      price: d.price,
      description: d.description,
      tagline: d.tagline,
      badgeLabel: d.badgeLabel,
      imageUrl: d.imageUrl,
      pityThreshold: d.pityThreshold,
      totalStock: d.totalStock,
      soldStock: d.soldStock,
      soldOut: d.soldOut,
    );
  }

  void _openOdds() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => OddsPage(gacha: _summary)));
  }

  Future<void> _onDraw(int count) async {
    final summary = _summary;
    final cost = summary.price * count;
    final bonus = count ~/ 10;
    final remaining = _detail?.remaining;
    if (_detail?.soldOut ?? false) {
      showToast(context, '품절된 박스예요');
      return;
    }
    if (remaining != null && remaining < count + bonus) {
      showToast(context, '남은 수량이 ${formatNumber(remaining)}개라 이만큼 뽑을 수 없어요');
      return;
    }
    final balance = context.read<GpProvider>().balance;

    if (balance < cost) {
      await _showShortfall(cost: cost, balance: balance);
      return;
    }

    final confirmed = await showAppSheet<bool>(
      context: context,
      title: bonus > 0 ? '$count+$bonus회 뽑기' : '$count회 뽑기',
      builder: (sheet) => _ConfirmSheetBody(
        rows: [
          InfoRow(
            label: '박스',
            value: summary.title,
            valueStyle: AppText.bodyStrong,
          ),
          InfoRow(
            label: '받는 상품',
            value: bonus > 0 ? '${count + bonus}개 (보너스 $bonus개 포함)' : '$count개',
          ),
          InfoRow(label: '사용', value: formatGp(cost)),
          const Hairline(),
          InfoRow(label: '뽑기 후 보유', value: formatGp(balance - cost)),
        ],
        note: '결과는 바로 보관함에 담겨요. 개봉한 뒤에는 환불할 수 없어요.',
        confirmLabel: '${formatGp(cost)} 사용하기',
        onCancel: () => Navigator.of(sheet).pop(false),
        onConfirm: () => Navigator.of(sheet).pop(true),
      ),
    );
    if (confirmed != true || !mounted) return;

    // 이전 결과의 스낵바가 연출 위에 남지 않게 닫는다.
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    final message = await Navigator.of(context).push<String>(
      PageRouteBuilder<String>(
        transitionDuration: Motion.slow,
        pageBuilder: (_, _, _) =>
            GachaAnimationPage(gacha: summary, count: count),
        transitionsBuilder: (_, animation, _, child) =>
            FadeTransition(opacity: animation, child: child),
      ),
    );
    if (!mounted) return;
    if (message != null) showToast(context, message);
    _load();
  }

  Future<void> _showShortfall({required int cost, required int balance}) async {
    final goCharge = await showAppSheet<bool>(
      context: context,
      title: 'GP가 부족해요',
      builder: (sheet) => _ConfirmSheetBody(
        rows: [
          InfoRow(label: '필요', value: formatGp(cost)),
          InfoRow(label: '보유', value: formatGp(balance)),
          const Hairline(),
          InfoRow(
            label: '부족',
            value: formatGp(cost - balance),
            valueStyle: AppText.num(
              AppText.headline,
            ).copyWith(color: AppColors.danger),
          ),
        ],
        confirmLabel: '충전하러 가기',
        cancelLabel: '닫기',
        onCancel: () => Navigator.of(sheet).pop(false),
        onConfirm: () => Navigator.of(sheet).pop(true),
      ),
    );
    if (goCharge == true && mounted) {
      context.read<TabNavigator>().goTo(context, AppTab.wallet);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final summary = _summary;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: AnimatedOpacity(
          duration: Motion.fast,
          opacity: _showTitle ? 1 : 0,
          child: Text(summary.title, style: AppText.headline),
        ),
        actions: const [GpBadge()],
      ),
      body: _loading
          ? const LoadingView(height: 400)
          : detail == null
          ? ErrorView(message: _error ?? '박스 정보를 불러오지 못했어요', onRetry: _load)
          : RefreshIndicator(
              color: AppColors.text,
              onRefresh: _load,
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.only(bottom: Space.x10),
                children: [
                  AspectRatio(
                    aspectRatio: 1,
                    child: ProductImage(
                      url: detail.imageUrl ?? widget.gacha.imageUrl,
                      borderRadius: BorderRadius.zero,
                    ),
                  ),
                  _Headline(detail: detail),
                  if (_pity?.hasPity ?? false) _PitySection(pity: _pity!),
                  const SectionBand(),
                  _OddsSummary(detail: detail, onOpenOdds: _openOdds),
                  const SectionBand(),
                  _LineupSection(items: detail.lineup),
                  const SectionBand(),
                  _Guide(detail: detail, onOpenOdds: _openOdds),
                ],
              ),
            ),
      bottomNavigationBar: detail == null
          ? null
          : _DrawBar(
              price: detail.price,
              soldOut: detail.soldOut,
              remaining: detail.remaining,
              onDraw: _onDraw,
            ),
    );
  }
}

class _Headline extends StatelessWidget {
  final GachaDetail detail;
  const _Headline({required this.detail});

  @override
  Widget build(BuildContext context) {
    final values = detail.lineup.map((i) => i.estimatedValue).toList()..sort();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        Space.x6,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (detail.badgeLabel != null) ...[
            QuietLabel(badgeLabelText(detail.badgeLabel!)),
            const SizedBox(height: Space.x2),
          ],
          Text(detail.title, style: AppText.title1),
          if (detail.description.isNotEmpty) ...[
            const SizedBox(height: Space.x1),
            Text(keepAll(detail.description), style: AppText.callout),
          ],
          const SizedBox(height: Space.x4),
          if (detail.soldOut) ...[
            const QuietLabel('품절', color: AppColors.danger),
            const SizedBox(height: Space.x2),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('1회', style: AppText.callout),
              const SizedBox(width: 6),
              Text(
                formatGp(detail.price),
                style: AppText.num(
                  AppText.title1,
                ).copyWith(fontWeight: FontWeight.w800),
              ),
              const Spacer(),
              if (values.isNotEmpty)
                Text(
                  '구성품 정가 ${formatNumber(values.first)}~${formatWon(values.last)}',
                  style: AppText.num(AppText.caption),
                ),
            ],
          ),
          if (detail.totalStock > 0) ...[
            const SizedBox(height: Space.x5),
            _StockLine(detail: detail),
          ],
        ],
      ),
    );
  }
}

/// 실재고: 판매 수량 / 전체 수량.
class _StockLine extends StatelessWidget {
  final GachaDetail detail;
  const _StockLine({required this.detail});

  @override
  Widget build(BuildContext context) {
    final total = detail.totalStock;
    final sold = detail.soldStock.clamp(0, total);
    final left = detail.remaining ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text('판매 현황', style: AppText.callout),
            const Spacer(),
            Text(
              '${formatNumber(sold)} / ${formatNumber(total)}개',
              style: AppText.num(AppText.bodyStrong),
            ),
          ],
        ),
        const SizedBox(height: Space.x2),
        ClipRRect(
          borderRadius: const BorderRadius.all(Radius.circular(2)),
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : sold / total,
            minHeight: 4,
            color: AppColors.text,
            backgroundColor: AppColors.high,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          detail.soldOut ? '모두 판매됐어요' : '남은 수량 ${formatNumber(left)}개',
          style: AppText.num(AppText.caption),
        ),
      ],
    );
  }
}

class _PitySection extends StatelessWidget {
  final PityStatus pity;
  const _PitySection({required this.pity});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x6,
      ),
      padding: const EdgeInsets.all(Space.x4),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.hairline),
        borderRadius: Radii.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const RarityTag(Rarity.ssr),
              const SizedBox(width: Space.x2),
              Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(text: '확정까지 '),
                    TextSpan(
                      text: '${pity.remaining}회',
                      style: AppText.num(AppText.headline),
                    ),
                  ],
                ),
                style: AppText.headline.copyWith(fontWeight: FontWeight.w500),
              ),
              const Spacer(),
              Text(
                '${formatNumber(pity.drawsSinceTopTier)}/${formatNumber(pity.threshold!)}',
                style: AppText.num(AppText.caption),
              ),
            ],
          ),
          const SizedBox(height: Space.x3),
          PityBar(progress: pity.progress),
          const SizedBox(height: Space.x2),
          Text(
            keepAll('이 박스에서 SSR 없이 ${pity.threshold}회째가 되면 그 회차는 SSR로 확정돼요.'),
            style: AppText.caption,
          ),
        ],
      ),
    );
  }
}

class _OddsSummary extends StatelessWidget {
  final GachaDetail detail;
  final VoidCallback onOpenOdds;

  const _OddsSummary({required this.detail, required this.onOpenOdds});

  @override
  Widget build(BuildContext context) {
    final tiers = detail.rarityOdds;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          title: '등급별 확률',
          actionLabel: '확률 및 구성 정보',
          onAction: onOpenOdds,
        ),
        Padding(
          padding: Space.page,
          child: Column(
            children: [
              for (var i = 0; i < tiers.length; i++) ...[
                if (i > 0) const Hairline(),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 44,
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: RarityTag(tiers[i].rarity),
                        ),
                      ),
                      const SizedBox(width: Space.x2),
                      Expanded(
                        child: _OddsBar(
                          percent: tiers[i].probabilityPercent,
                          color: tiers[i].rarity.color,
                        ),
                      ),
                      const SizedBox(width: Space.x3),
                      SizedBox(
                        width: 72,
                        child: Text(
                          formatPercent(tiers[i].probabilityPercent),
                          textAlign: TextAlign.right,
                          style: AppText.num(AppText.bodyStrong),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: Space.x5),
      ],
    );
  }
}

/// 확률의 상대 크기를 보여주는 짧은 막대(로그 스케일 아님, 0~100%).
class _OddsBar extends StatelessWidget {
  final double percent;
  final Color color;
  const _OddsBar({required this.percent, required this.color});

  @override
  Widget build(BuildContext context) {
    final factor = (percent / 100).clamp(0.0, 1.0);
    return SizedBox(
      height: 4,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const ColoredBox(color: AppColors.high),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: factor < 0.03 && factor > 0 ? 0.03 : factor,
            child: ColoredBox(color: color),
          ),
        ],
      ),
    );
  }
}

class _LineupSection extends StatelessWidget {
  final List<LineupItem> items;
  const _LineupSection({required this.items});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: '구성 상품', subtitle: '총 ${items.length}종 · 희귀한 순'),
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const Hairline(inset: Space.gutter),
          LineupRow(item: items[i]),
        ],
        const SizedBox(height: Space.x3),
      ],
    );
  }
}

/// 구성 상품 한 줄: 사진 · 등급 · 이름 · 정가/전환가 · 확률.
class LineupRow extends StatelessWidget {
  final LineupItem item;
  const LineupRow({super.key, required this.item});

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
            width: 64,
            height: 64,
            child: ProductImage(url: item.imageUrl),
          ),
          const SizedBox(width: Space.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RarityTag(item.rarity, dense: true),
                const SizedBox(height: 4),
                Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong,
                ),
                const SizedBox(height: 2),
                Text(
                  item.exchangeValue != null
                      ? '정가 ${formatWon(item.estimatedValue)} · 전환 ${formatGp(item.exchangeValue!)}'
                      : '정가 ${formatWon(item.estimatedValue)}',
                  style: AppText.num(AppText.caption),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.x2),
          Text(
            formatPercent(item.probabilityPercent),
            style: AppText.num(AppText.bodyStrong),
          ),
        ],
      ),
    );
  }
}

class _Guide extends StatelessWidget {
  final GachaDetail detail;
  final VoidCallback onOpenOdds;
  const _Guide({required this.detail, required this.onOpenOdds});

  @override
  Widget build(BuildContext context) {
    final lines = <String>[
      '10회 뽑기마다 1회를 더 드려요(10+1). 보너스 회차도 같은 확률로 뽑아요.',
      if (detail.pityThreshold != null)
        '천장: 이 박스에서 SSR 없이 ${detail.pityThreshold}회째 뽑으면 SSR이 확정돼요. SSR을 받으면 다시 0회부터 셉니다.',
      '받은 상품은 보관함에 담기고, 정가의 80%를 GP로 전환하거나 배송 신청(배송비 3,000 GP)할 수 있어요.',
      '개봉한 박스는 환불할 수 없어요. 재고가 모두 판매되면 판매가 일찍 끝날 수 있어요.',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: '이용 안내'),
        Padding(
          padding: Space.page,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final line in lines)
                Padding(
                  padding: const EdgeInsets.only(bottom: Space.x2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 8, right: Space.x2),
                        child: Container(
                          width: 3,
                          height: 3,
                          color: AppColors.textTertiary,
                        ),
                      ),
                      Expanded(
                        child: Text(keepAll(line), style: AppText.callout),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: Space.x3),
              OutlinedButton.icon(
                onPressed: onOpenOdds,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                icon: const Icon(Icons.percent, size: 18),
                label: const Text('확률 및 구성 정보 전체 보기'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DrawBar extends StatelessWidget {
  final int price;
  final bool soldOut;

  /// 남은 수량(없으면 제한 없음). 10+1은 11개를 쓰므로 11개 미만이면 막는다.
  final int? remaining;
  final ValueChanged<int> onDraw;

  const _DrawBar({
    required this.price,
    required this.soldOut,
    required this.remaining,
    required this.onDraw,
  });

  @override
  Widget build(BuildContext context) {
    final left = remaining;
    final canSingle = !soldOut && (left == null || left >= 1);
    final canMulti = !soldOut && (left == null || left >= 11);
    if (soldOut) {
      return _BarFrame(
        child: OutlinedButton(
          onPressed: null,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(56),
          ),
          child: const _TwoLine(
            title: '품절',
            price: '준비된 수량이 모두 판매됐어요',
            color: AppColors.textTertiary,
          ),
        ),
      );
    }
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.canvas,
        border: Border(top: BorderSide(color: AppColors.hairline)),
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
              Expanded(
                flex: 4,
                child: OutlinedButton(
                  onPressed: canSingle ? () => onDraw(1) : null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 56),
                    padding: EdgeInsets.zero,
                  ),
                  child: _TwoLine(
                    title: '1회 뽑기',
                    price: formatGp(price),
                    color: canSingle ? AppColors.text : AppColors.textTertiary,
                  ),
                ),
              ),
              const SizedBox(width: Space.x2),
              Expanded(
                flex: 6,
                child: FilledButton(
                  onPressed: canMulti ? () => onDraw(10) : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 56),
                    padding: EdgeInsets.zero,
                  ),
                  child: _TwoLine(
                    title: '10+1회 뽑기',
                    price: canMulti
                        ? formatGp(price * 10)
                        : '남은 수량 ${formatNumber(left ?? 0)}개',
                    color: canMulti ? AppColors.canvas : AppColors.textTertiary,
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

/// 하단 고정 바의 공통 테두리·여백.
class _BarFrame extends StatelessWidget {
  final Widget child;
  const _BarFrame({required this.child});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.canvas,
        border: Border(top: BorderSide(color: AppColors.hairline)),
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
          child: child,
        ),
      ),
    );
  }
}

class _TwoLine extends StatelessWidget {
  final String title;
  final String price;
  final Color color;
  const _TwoLine({
    required this.title,
    required this.price,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          style: AppText.headline.copyWith(color: color, height: 1.2),
        ),
        const SizedBox(height: 2),
        Text(
          price,
          style: AppText.num(
            AppText.caption,
          ).copyWith(color: color.withValues(alpha: 0.75), height: 1.2),
        ),
      ],
    );
  }
}

/// 확인 시트 본문: 정보 행 + 안내 + 취소/확인.
class _ConfirmSheetBody extends StatelessWidget {
  final List<Widget> rows;
  final String? note;
  final String confirmLabel;
  final String cancelLabel;
  final VoidCallback onCancel;
  final VoidCallback onConfirm;

  const _ConfirmSheetBody({
    required this.rows,
    required this.confirmLabel,
    required this.onCancel,
    required this.onConfirm,
    this.note,
    this.cancelLabel = '취소',
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x2,
        Space.gutter,
        Space.x4,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Space.x4,
              vertical: Space.x2,
            ),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: Radii.card,
            ),
            child: Column(children: rows),
          ),
          if (note != null) ...[
            const SizedBox(height: Space.x3),
            Text(note!, style: AppText.caption),
          ],
          const SizedBox(height: Space.x5),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onCancel,
                  child: Text(cancelLabel),
                ),
              ),
              const SizedBox(width: Space.x2),
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: onConfirm,
                  child: Text(confirmLabel),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
