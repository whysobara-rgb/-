import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/theme/rarity_style.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/collectible_card.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/meters.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/gacha_repository.dart';
import '../domain/gacha_models.dart';
import 'gacha_animation_page.dart';
import 'odds_page.dart';
import 'widgets/box_thumb.dart';

/// 박스 상세.
///
/// 밝은 스튜디오 헤더(박스 패키지) → 제목·대표 경품 → 가격·실재고 카드 →
/// 금빛 천장 게이지 → 등급별 구성 상품(컬렉터블 카드, SR/SSR 포일) →
/// 등급별 확률 요약 → 이용 안내. 하단 고정 바에 "1회"와 "10+1회".
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

  /// 헤더를 지나 스크롤하면 앱바에 박스명을 보여준다.
  final _scroll = ScrollController();
  bool _showTitle = false;

  static const double _headerHeight = 360;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      final show = _scroll.hasClients && _scroll.offset > _headerHeight - 110;
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
      iconName: d.iconName ?? widget.gacha.iconName,
      accent: d.accent ?? widget.gacha.accent,
      topPrize: widget.gacha.topPrize,
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
      extendBody: true,
      body: _loading
          ? const SafeArea(child: LoadingView(height: 400))
          : detail == null
          ? SafeArea(
              child: Column(
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: BackButton(),
                  ),
                  ErrorView(
                    message: _error ?? '박스 정보를 불러오지 못했어요',
                    onRetry: _load,
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              color: AppColors.brand,
              backgroundColor: AppColors.raised,
              onRefresh: _load,
              child: CustomScrollView(
                controller: _scroll,
                slivers: [
                  SliverAppBar(
                    pinned: true,
                    expandedHeight: _headerHeight,
                    backgroundColor: AppColors.canvas,
                    automaticallyImplyLeading: false,
                    titleSpacing: 0,
                    leadingWidth: 60,
                    leading: Center(
                      child: _showTitle
                          ? const BackButton()
                          : CircleIconButton(
                              icon: Icons.arrow_back_rounded,
                              tooltip: '뒤로',
                              onPressed: () => Navigator.of(context).maybePop(),
                            ),
                    ),
                    title: AnimatedOpacity(
                      duration: Motion.fast,
                      opacity: _showTitle ? 1 : 0,
                      child: Text(summary.title, style: AppText.headline),
                    ),
                    actions: const [GpBadge()],
                    flexibleSpace: FlexibleSpaceBar(
                      collapseMode: CollapseMode.parallax,
                      background: _StudioHeader(summary: summary),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: _TitleBlock(detail: detail, summary: summary),
                  ),
                  SliverToBoxAdapter(child: _PriceBlock(detail: detail)),
                  if (_pity?.hasPity ?? false)
                    SliverToBoxAdapter(child: _PityMeter(pity: _pity!)),
                  const SliverToBoxAdapter(child: SizedBox(height: Space.x6)),
                  const SliverToBoxAdapter(child: SectionBand()),
                  SliverToBoxAdapter(
                    child: _LineupSection(
                      items: detail.lineup,
                      onOpenOdds: _openOdds,
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: _OddsSummary(detail: detail, onOpenOdds: _openOdds),
                  ),
                  SliverToBoxAdapter(
                    child: _Guide(detail: detail, onOpenOdds: _openOdds),
                  ),
                  const SliverToBoxAdapter(child: SizedBox(height: 132)),
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

/// 밝은 스튜디오 헤더: 박스 색을 옅게 깐 배경 + 선버스트 + 큰 패키지.
/// 아래쪽은 흰 시트가 둥글게 덮어 올라온다.
class _StudioHeader extends StatelessWidget {
  final GachaSummary summary;
  const _StudioHeader({required this.summary});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: BoxThumb(box: summary, scale: 0.6, centerY: 0.56, rays: true),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 28,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: AppColors.canvas,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(Radii.xl),
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF101828).withValues(alpha: 0.06),
                  blurRadius: 12,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// 배지·한 줄 소개·큰 제목·설명·대표 경품.
class _TitleBlock extends StatelessWidget {
  final GachaDetail detail;
  final GachaSummary summary;
  const _TitleBlock({required this.detail, required this.summary});

  @override
  Widget build(BuildContext context) {
    final prize = summary.topPrize;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.gutter, 0, Space.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (detail.badgeLabel != null) ...[
                BoxBadge(detail.badgeLabel!),
                const SizedBox(width: 8),
              ],
              if (detail.soldOut)
                const QuietLabel('품절', color: AppColors.danger)
              else if (detail.tagline != null)
                Flexible(
                  child: Text(
                    detail.tagline!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.callout.copyWith(
                      color: AppColors.brand,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Space.x2),
          Text(detail.title, style: AppText.display),
          if (detail.description.isNotEmpty) ...[
            const SizedBox(height: Space.x1),
            Text(keepAll(detail.description), style: AppText.callout),
          ],
          if (prize != null) ...[
            const SizedBox(height: Space.x3),
            _TopPrizeLine(prize: prize),
          ],
        ],
      ),
    );
  }
}

class _TopPrizeLine extends StatelessWidget {
  final TopPrize prize;
  const _TopPrizeLine({required this.prize});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(5, 5, 12, 5),
      decoration: BoxDecoration(
        color: prize.rarity.color.withValues(alpha: 0.1),
        borderRadius: Radii.pill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          RarityTag(prize.rarity, holo: true),
          const SizedBox(width: 8),
          Flexible(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: prize.name),
                  TextSpan(
                    text: '  ${formatWon(prize.estimatedValue)}',
                    style: TextStyle(
                      color: prize.rarity.ink,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.num(
                AppText.caption,
              ).copyWith(color: AppColors.text, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// 가격(큰 숫자) + 구성품 정가 범위 + 실재고.
class _PriceBlock extends StatelessWidget {
  final GachaDetail detail;
  const _PriceBlock({required this.detail});

  @override
  Widget build(BuildContext context) {
    final values = detail.lineup.map((i) => i.estimatedValue).toList()..sort();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        0,
      ),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('1회 가격', style: AppText.caption),
                      const SizedBox(height: 4),
                      PriceText(detail.price, size: 34),
                    ],
                  ),
                ),
                if (values.isNotEmpty)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('구성품 정가', style: AppText.caption),
                      const SizedBox(height: 4),
                      Text(
                        '${formatWonShort(values.first)} ~ ${formatWonShort(values.last)}',
                        style: AppText.num(AppText.headline).copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.text,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            if (detail.totalStock > 0) ...[
              const SizedBox(height: Space.x4),
              const Hairline(),
              const SizedBox(height: Space.x3),
              StockBar(
                total: detail.totalStock,
                sold: detail.soldStock,
                soldOut: detail.soldOut,
                compact: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 천장 게이지: 옅은 금빛 카드 + 큰 남은 횟수 + 금박 막대.
class _PityMeter extends StatelessWidget {
  final PityStatus pity;
  const _PityMeter({required this.pity});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x3,
        Space.gutter,
        0,
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
        decoration: BoxDecoration(
          borderRadius: Radii.card,
          border: Border.all(
            color: AppColors.raritySSR.withValues(alpha: 0.45),
          ),
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFFFF8E1), Color(0xFFFFFDF6)],
          ),
          boxShadow: Rarity.ssr.glow(0.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const RarityTag(Rarity.ssr, holo: true),
                const SizedBox(width: 6),
                Text(
                  '천장 · 내 진행도',
                  style: AppText.caption.copyWith(
                    color: AppColors.raritySSRInk,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Spacer(),
                Text(
                  '${formatNumber(pity.drawsSinceTopTier)} / ${formatNumber(pity.threshold!)}회',
                  style: AppText.num(AppText.caption),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(
                children: [
                  const TextSpan(
                    text: 'SSR 확정까지 ',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.3,
                      color: AppColors.text,
                    ),
                  ),
                  TextSpan(text: formatNumber(pity.remaining ?? 0)),
                  const TextSpan(
                    text: '회',
                    style: TextStyle(fontSize: 18, letterSpacing: 0),
                  ),
                ],
              ),
              style: AppText.numeral.copyWith(
                fontSize: 34,
                color: AppColors.raritySSRInk,
              ),
            ),
            const SizedBox(height: 10),
            GlowMeter(progress: pity.progress),
            const SizedBox(height: 6),
            Text(
              keepAll(
                '이 박스에서 SSR 없이 ${formatNumber(pity.threshold!)}회째가 되면 그 회차는 SSR로 확정돼요.',
              ),
              style: AppText.caption,
            ),
          ],
        ),
      ),
    );
  }
}

/// 구성 상품: 등급별로 묶은 컬렉터블 카드.
class _LineupSection extends StatelessWidget {
  final List<LineupItem> items;
  final VoidCallback onOpenOdds;
  const _LineupSection({required this.items, required this.onOpenOdds});

  @override
  Widget build(BuildContext context) {
    final tiers = <Rarity, List<LineupItem>>{};
    for (final i in items) {
      (tiers[i.rarity] ??= []).add(i);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          title: '구성 상품',
          subtitle: '총 ${items.length}종 · 희귀한 순 · 카드의 %는 1회 확률',
          actionLabel: '전체 확률',
          onAction: onOpenOdds,
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x6,
            Space.gutter,
            Space.x1,
          ),
        ),
        for (final rarity in Rarity.values.reversed)
          if (tiers[rarity] case final list?)
            _TierBlock(rarity: rarity, items: list),
      ],
    );
  }
}

class _TierBlock extends StatelessWidget {
  final Rarity rarity;
  final List<LineupItem> items;
  const _TierBlock({required this.rarity, required this.items});

  @override
  Widget build(BuildContext context) {
    final total = items.fold<double>(0, (s, i) => s + i.probabilityPercent);
    final hero = rarity == Rarity.ssr;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x5,
        Space.gutter,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              RarityTag(rarity, holo: hero),
              const SizedBox(width: 8),
              Text(
                rarity.label,
                style: AppText.bodyStrong.copyWith(
                  color: rarity.ink,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  height: 1,
                  color: rarity == Rarity.n
                      ? AppColors.hairline
                      : rarity.color.withValues(alpha: 0.28),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '합계 ${formatPercent(total)}',
                style: AppText.num(
                  AppText.caption,
                ).copyWith(color: AppColors.text, fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, c) {
              final cols = items.length == 1 ? 1 : 2;
              const gap = 12.0;
              final w = (c.maxWidth - gap * (cols - 1)) / cols;
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: [
                  for (final item in items)
                    SizedBox(
                      width: w,
                      child: CollectibleCard(
                        rarity: item.rarity,
                        name: item.name,
                        imageUrl: item.imageUrl,
                        holo: hero,
                        imageAspect: cols == 1 ? 1.7 : (hero ? 0.92 : 1.12),
                        meta: formatWon(item.estimatedValue),
                        trailing: formatPercent(item.probabilityPercent),
                      ),
                    ),
                ],
              );
            },
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x8,
        Space.gutter,
        0,
      ),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '등급별 확률',
                    style: AppText.headline.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text('소수 넷째 자리까지 공개', style: AppText.micro),
              ],
            ),
            const SizedBox(height: 12),
            // 한눈에 보는 비율 막대(아주 작은 확률도 보이게 최소 폭).
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: SizedBox(
                height: 8,
                child: Row(
                  children: [
                    for (final t in tiers.reversed)
                      Expanded(
                        flex: (t.probabilityPercent * 10).round().clamp(
                          18,
                          1000,
                        ),
                        child: Container(
                          margin: const EdgeInsets.only(right: 2),
                          decoration: BoxDecoration(
                            gradient: t.rarity.foilGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < tiers.length; i++) ...[
              if (i > 0) const Hairline(),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 11),
                child: Row(
                  children: [
                    SizedBox(
                      width: 46,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: RarityTag(tiers[i].rarity),
                      ),
                    ),
                    Text(
                      '${tiers[i].rarity.label} · ${tiers[i].itemCount}종',
                      style: AppText.num(AppText.callout),
                    ),
                    const Spacer(),
                    Text(
                      formatPercent(tiers[i].probabilityPercent),
                      style: AppText.num(AppText.headline).copyWith(
                        color: tiers[i].rarity == Rarity.n
                            ? AppColors.text
                            : tiers[i].rarity.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const Hairline(),
            InkWell(
              onTap: onOpenOdds,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 13),
                child: Row(
                  children: [
                    const Icon(
                      Icons.verified_outlined,
                      size: 17,
                      color: AppColors.brand,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '확률 및 구성 정보 · 천장 · 기대 가치',
                        style: AppText.callout.copyWith(
                          color: AppColors.text,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      size: 20,
                      color: AppColors.textTertiary,
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

class _Guide extends StatelessWidget {
  final GachaDetail detail;
  final VoidCallback onOpenOdds;
  const _Guide({required this.detail, required this.onOpenOdds});

  @override
  Widget build(BuildContext context) {
    final lines = <String>[
      '10회 뽑기마다 1회를 더 드려요(10+1). 보너스 회차도 같은 확률로 뽑아요.',
      if (detail.pityThreshold != null)
        '천장: 이 박스에서 SSR 없이 ${formatNumber(detail.pityThreshold!)}회째 뽑으면 SSR이 확정돼요. SSR을 받으면 다시 0회부터 셉니다.',
      '받은 상품은 보관함에 담기고, 정가의 80%를 GP로 전환하거나 배송 신청(배송비 3,000 GP)할 수 있어요.',
      '개봉한 박스는 환불할 수 없어요. 재고가 모두 판매되면 판매가 일찍 끝날 수 있어요.',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(
          title: '이용 안내',
          padding: EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x8,
            Space.gutter,
            Space.x3,
          ),
        ),
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
                          width: 4,
                          height: 4,
                          decoration: const BoxDecoration(
                            color: AppColors.textTertiary,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Text(keepAll(line), style: AppText.callout),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// 하단 고정 CTA: 흰 바 위 "1회"(테두리) / "10+1회"(캡슐 레드 + 금박 보너스 꼬리표).
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
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.raised,
        boxShadow: Shadows.bar,
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
          child: soldOut
              ? OutlinedButton(
                  onPressed: null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(58),
                  ),
                  child: const _TwoLine(
                    title: '품절',
                    price: '준비된 수량이 모두 판매됐어요',
                    color: AppColors.textTertiary,
                  ),
                )
              : Row(
                  children: [
                    Expanded(
                      flex: 4,
                      child: OutlinedButton(
                        onPressed: canSingle ? () => onDraw(1) : null,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 58),
                          padding: EdgeInsets.zero,
                          side: const BorderSide(
                            color: AppColors.text,
                            width: 1.4,
                          ),
                        ),
                        child: _TwoLine(
                          title: '1회 뽑기',
                          price: formatGp(price),
                          color: canSingle
                              ? AppColors.text
                              : AppColors.textTertiary,
                        ),
                      ),
                    ),
                    const SizedBox(width: Space.x2),
                    Expanded(
                      flex: 6,
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          DecoratedBox(
                            decoration: BoxDecoration(
                              borderRadius: Radii.button,
                              boxShadow: canMulti
                                  ? Shadows.tinted(
                                      AppColors.brand,
                                      strength: 0.8,
                                    )
                                  : null,
                            ),
                            child: SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: canMulti ? () => onDraw(10) : null,
                                style: FilledButton.styleFrom(
                                  minimumSize: const Size(0, 58),
                                  padding: EdgeInsets.zero,
                                ),
                                child: _TwoLine(
                                  title: '10+1회 뽑기',
                                  price: canMulti
                                      ? formatGp(price * 10)
                                      : '남은 수량 ${formatNumber(left ?? 0)}개',
                                  color: canMulti
                                      ? AppColors.onBrand
                                      : AppColors.textTertiary,
                                ),
                              ),
                            ),
                          ),
                          if (canMulti)
                            Positioned(
                              right: 10,
                              top: -10,
                              child: Container(
                                height: 20,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 7,
                                ),
                                decoration: BoxDecoration(
                                  gradient: Rarity.ssr.foilGradient(
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  ),
                                  borderRadius: Radii.pill,
                                  boxShadow: Shadows.small,
                                ),
                                child: Center(
                                  widthFactor: 1,
                                  child: Text(
                                    '+1 보너스',
                                    style: AppText.micro.copyWith(
                                      color: Rarity.ssr.onColor,
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w900,
                                      height: 1,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
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
          style: AppText.headline.copyWith(
            color: color,
            height: 1.2,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          price,
          style: AppText.num(AppText.caption).copyWith(
            color: color.withValues(alpha: 0.8),
            height: 1.2,
            fontWeight: FontWeight.w700,
          ),
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
          SheetPanel(child: Column(children: rows)),
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
