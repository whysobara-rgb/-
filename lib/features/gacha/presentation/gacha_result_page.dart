import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/theme/rarity_style.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/collectible_card.dart';
import '../../../shared/widgets/meters.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../../inventory/data/inventory_repository.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_models.dart';
import '../domain/reveal_timeline.dart';
import 'widgets/gacha_fx_painters.dart';
import 'widgets/reveal_card.dart';

/// 뽑기 결과.
///
/// 결과는 서버에서 이미 보관함에 담긴 상태다. 기본 동작은 "보관함에 보관"
/// (그대로 두기)이고, 원하면 그 자리에서 정가의 80%를 GP로 전환할 수 있다.
/// SR 이상이 나오면 들어올 때 한 번 축하 연출(불꽃·SSR 금박)과 홀로 카드,
/// 그리고 실제 결과 문구만 담은 "자랑하기"를 보여준다.
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

class _GachaResultPageState extends State<GachaResultPage>
    with TickerProviderStateMixin {
  static const _inventory = InventoryRepository();
  bool _exchanging = false;
  bool _exchanged = false;

  /// 들어올 때 한 번 터지는 축하(SR 이상).
  late final AnimationController _celebrate = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3600),
  );

  /// 빛줄기 회전.
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 24),
  );

  late final List<GoldLeaf> _leaves = GoldLeafPainter.generate(
    60,
    seed: 7,
    palette: kConfettiOnLight,
  );
  Offset _tilt = Offset.zero;

  DrawOutcome get _o => widget.outcome;
  DrawResult? get _best => _o.best;
  bool get _festive => _best?.rarity.isFoil ?? false;

  @override
  void initState() {
    super.initState();
    if (_festive) {
      _celebrate.forward();
      _spin.repeat();
    }
  }

  @override
  void dispose() {
    _celebrate.dispose();
    _spin.dispose();
    super.dispose();
  }

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

  /// 실제 결과만 담은 공유 문구.
  String get _brag {
    final b = _best!;
    final extra = _o.results.length > 1 ? ' (${_o.results.length}개 중)' : '';
    return '가치가차 ${widget.gacha.title}에서 ${b.rarity.code} ${b.name}'
        '(정가 ${formatWon(b.estimatedValue)})을 받았어요!$extra';
  }

  Future<void> _share() async {
    final text = _brag;
    if (kIsWeb) {
      // 웹 공유 시트가 없는 브라우저는 메일 앱으로 넘어가므로 복사로 대신한다.
      await Clipboard.setData(ClipboardData(text: text));
      if (mounted) showToast(context, '자랑 문구를 복사했어요');
      return;
    }
    try {
      await SharePlus.instance.share(ShareParams(text: text, subject: '가치가차'));
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: text));
      if (mounted) showToast(context, '자랑 문구를 복사했어요');
    }
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
            SheetPanel(
              child: Column(
                children: [
                  InfoRow(label: '상품 정가 합계', value: formatWon(_o.totalValue)),
                  InfoRow(
                    label: '받는 GP',
                    value: formatGp(total),
                    valueStyle: AppText.num(
                      AppText.headline,
                    ).copyWith(color: AppColors.brand),
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
        body: Stack(
          children: [
            ListView(
              padding: const EdgeInsets.only(bottom: Space.x8),
              children: [
                if (best != null)
                  _Hero(
                    result: best,
                    caption: isSingle
                        ? '${widget.gacha.title} · 1회'
                        : '${widget.gacha.title} · 이번 최고',
                    spin: _spin,
                    festive: _festive,
                    tilt: _tilt,
                    onTilt: (t) => setState(() => _tilt = t),
                    onShare: _festive ? _share : null,
                  ),
                if (!isSingle) ...[
                  _CountsHeader(outcome: _o),
                  _ResultGrid(results: sorted),
                ],
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.gutter,
                    Space.x5,
                    Space.gutter,
                    0,
                  ),
                  child: AppCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Space.x4,
                      vertical: Space.x2,
                    ),
                    child: Column(
                      children: [
                        InfoRow(label: '사용', value: formatGp(_o.spent)),
                        InfoRow(
                          label: '받은 상품 정가',
                          value: formatWon(_o.totalValue),
                        ),
                        if (_o.totalExchange > 0)
                          InfoRow(
                            label: '포인트 전환 시',
                            value: formatGp(_o.totalExchange),
                            valueStyle: AppText.num(
                              AppText.bodyStrong,
                            ).copyWith(color: AppColors.textSecondary),
                          ),
                      ],
                    ),
                  ),
                ),
                if (_o.pity?.hasPity ?? false) _PityLine(pity: _o.pity!),
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.gutter,
                    Space.x5,
                    Space.gutter,
                    0,
                  ),
                  child: Text(
                    keepAll('보관한 상품은 보관함에서 언제든 배송 신청하거나 포인트로 전환할 수 있어요.'),
                    style: AppText.caption.copyWith(
                      color: AppColors.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
            if (_festive)
              Positioned.fill(
                child: IgnorePointer(
                  child: AnimatedBuilder(
                    animation: _celebrate,
                    builder: (context, _) {
                      final t = _celebrate.value;
                      if (t <= 0 || t >= 1) return const SizedBox.shrink();
                      final r = best!.rarity;
                      return LayoutBuilder(
                        builder: (context, c) => Stack(
                          fit: StackFit.expand,
                          children: [
                            CustomPaint(
                              painter: SparkBurstPainter(
                                age: t * 3.6 * 0.6,
                                color: r.color,
                                count: RevealTimeline.sparkCount(r),
                                origin: Offset(c.maxWidth / 2, 200),
                                power: 0.7,
                              ),
                            ),
                            if (r == Rarity.ssr)
                              CustomPaint(
                                painter: GoldLeafPainter(
                                  progress: t,
                                  pieces: _leaves,
                                ),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
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

/// 대표 결과: 등급 색으로 물든 밝은 무대 + 빛줄기 + 큰 카드(SSR 홀로·틸트)
/// + 이름·정가 + 자랑하기.
class _Hero extends StatelessWidget {
  final DrawResult result;
  final String caption;
  final Animation<double> spin;
  final bool festive;
  final Offset tilt;
  final ValueChanged<Offset> onTilt;
  final VoidCallback? onShare;

  const _Hero({
    required this.result,
    required this.caption,
    required this.spin,
    required this.festive,
    required this.tilt,
    required this.onTilt,
    required this.onShare,
  });

  static Color _wash(Rarity r) => switch (r) {
    Rarity.n => const Color(0xFFF1F3F6),
    Rarity.r => const Color(0xFFE3EDFF),
    Rarity.sr => const Color(0xFFEFE4FF),
    Rarity.ssr => const Color(0xFFFFF0C2),
  };

  @override
  Widget build(BuildContext context) {
    final r = result.rarity;
    const cardW = 204.0;
    return Column(
      children: [
        SizedBox(
          // 폭을 꽉 채운다(느슨한 폭이면 Stack이 카드 폭으로 줄어 배경이 기둥처럼 잘린다).
          width: double.infinity,
          height: cardW * 1.4 + 64,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // 바탕(등급 색 → 흰색) + 가운데 흰 빛 + 회전하는 빛줄기를 한 장의
              // 그림으로 그리고, 매 프레임 도는 빛줄기가 카드까지 다시 그리지 않게
              // 별도 층으로 둔다.
              Positioned.fill(
                child: RepaintBoundary(
                  child: festive
                      ? AnimatedBuilder(
                          animation: spin,
                          builder: (context, _) => CustomPaint(
                            painter: _HeroBackdropPainter(
                              wash: _wash(r),
                              rays: r.color,
                              rayCount: r == Rarity.ssr ? 16 : 12,
                              intensity: r == Rarity.ssr ? 0.75 : 0.55,
                              rotation: spin.value * 2 * math.pi,
                            ),
                          ),
                        )
                      : CustomPaint(
                          painter: _HeroBackdropPainter(wash: _wash(r)),
                        ),
                ),
              ),
              CardGlow(rarity: r, width: cardW),
              GestureDetector(
                onPanUpdate: (d) => onTilt(
                  Offset(
                    (tilt.dx + d.delta.dx / 90).clamp(-1.0, 1.0),
                    (tilt.dy + d.delta.dy / 90).clamp(-1.0, 1.0),
                  ),
                ),
                onPanEnd: (_) => onTilt(Offset.zero),
                // 기울이지 않을 때는 3D 변환 없이 그린다(웹 합성 비용·잔상 방지).
                child: tilt == Offset.zero
                    ? RevealCardFace(result: result, width: cardW, glow: 0)
                    : Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.identity()
                          ..setEntry(3, 2, 0.0012)
                          ..rotateY(tilt.dx * 0.25)
                          ..rotateX(-tilt.dy * 0.2),
                        child: RevealCardFace(
                          result: result,
                          width: cardW,
                          tilt: tilt,
                          glow: 0,
                        ),
                      ),
              ),
            ],
          ),
        ),
        Padding(
          padding: Space.page,
          child: Column(
            children: [
              Text(caption, style: AppText.caption),
              const SizedBox(height: 6),
              Text(
                result.name,
                textAlign: TextAlign.center,
                style: AppText.display.copyWith(fontSize: 26),
              ),
              const SizedBox(height: 6),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '정가 ${formatWon(result.estimatedValue)}',
                      style: TextStyle(
                        color: r == Rarity.n ? AppColors.text : r.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (result.exchangeValue > 0)
                      TextSpan(
                        text: '  ·  전환 시 ${formatGp(result.exchangeValue)}',
                      ),
                  ],
                ),
                textAlign: TextAlign.center,
                style: AppText.num(AppText.callout).copyWith(
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (onShare != null) ...[
                const SizedBox(height: Space.x4),
                FilledButton.icon(
                  onPressed: onShare,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 40),
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    shape: const StadiumBorder(),
                    backgroundColor: AppColors.text,
                    foregroundColor: Colors.white,
                    textStyle: AppText.bodyStrong.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  icon: const Icon(Icons.ios_share_rounded, size: 17),
                  label: const Text('자랑하기'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _HeroBackdropPainter extends CustomPainter {
  final Color wash;
  final Color? rays;
  final int rayCount;
  final double intensity;
  final double rotation;

  _HeroBackdropPainter({
    required this.wash,
    this.rays,
    this.rayCount = 12,
    this.intensity = 0,
    this.rotation = 0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [wash, AppColors.canvas],
          stops: const [0.45, 1],
        ).createShader(rect),
    );
    final c = Offset(size.width / 2, size.height * 0.45);
    final glow = size.shortestSide * 0.7;
    canvas.drawCircle(
      c,
      glow,
      Paint()
        ..shader = RadialGradient(
          colors: [Colors.white, Colors.white.withValues(alpha: 0)],
        ).createShader(Rect.fromCircle(center: c, radius: glow)),
    );
    final r = rays;
    if (r != null && intensity > 0) {
      LightRaysPainter(
        rotation: rotation,
        intensity: intensity,
        color: r,
        rays: rayCount,
        origin: size.center(Offset.zero),
      ).paint(canvas, size);
      // 위·아래 가장자리에서 빛줄기가 칼같이 잘리지 않게 바탕색으로 덮는다.
      final top = Rect.fromLTWH(0, 0, size.width, 56);
      canvas.drawRect(
        top,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [wash, wash.withValues(alpha: 0)],
          ).createShader(top),
      );
      final bottom = Rect.fromLTWH(0, size.height - 72, size.width, 72);
      canvas.drawRect(
        bottom,
        Paint()
          ..shader = const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0x00FFFFFF), AppColors.canvas],
          ).createShader(bottom),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _HeroBackdropPainter old) =>
      old.wash != wash ||
      old.rays != rays ||
      old.rotation != rotation ||
      old.intensity != intensity;
}

class _CountsHeader extends StatelessWidget {
  final DrawOutcome outcome;
  const _CountsHeader({required this.outcome});

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
        Space.x8,
        Space.gutter,
        Space.x3,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(drawLabel, style: AppText.eyebrow),
          const SizedBox(height: 4),
          Text('${outcome.results.length}개를 받았어요', style: AppText.title1),
          const SizedBox(height: Space.x3),
          Row(
            children: [
              for (final rarity in Rarity.values.reversed) ...[
                Expanded(
                  child: _CountCell(rarity: rarity, count: counts[rarity] ?? 0),
                ),
                if (rarity != Rarity.n) const SizedBox(width: 6),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _CountCell extends StatelessWidget {
  final Rarity rarity;
  final int count;
  const _CountCell({required this.rarity, required this.count});

  @override
  Widget build(BuildContext context) {
    final on = count > 0;
    return Container(
      height: 56,
      decoration: BoxDecoration(
        color: on ? rarity.color.withValues(alpha: 0.1) : AppColors.surface,
        borderRadius: Radii.button,
        border: Border.all(
          color: on ? rarity.color.withValues(alpha: 0.45) : AppColors.hairline,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            rarity.code,
            style: AppText.micro.copyWith(
              color: on ? rarity.ink : AppColors.textTertiary,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.6,
            ),
          ),
          Text(
            '$count',
            style: AppText.num(AppText.headline).copyWith(
              color: on ? AppColors.text : AppColors.textTertiary,
              fontWeight: FontWeight.w900,
              fontSize: 18,
              height: 1.2,
            ),
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
        Space.x2,
        Space.gutter,
        0,
      ),
      child: LayoutBuilder(
        builder: (context, c) {
          const columns = 3;
          const gap = 8.0;
          final w = (c.maxWidth - gap * (columns - 1)) / columns;
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (final r in results)
                SizedBox(
                  width: w,
                  child: CollectibleCard(
                    rarity: r.rarity,
                    name: r.name,
                    imageUrl: r.imageUrl,
                    dense: true,
                    holo: r.rarity == Rarity.ssr,
                    meta: formatWonShort(r.estimatedValue),
                    labels: [if (r.isPity) '천장', if (r.isBonus) '보너스'],
                  ),
                ),
            ],
          );
        },
      ),
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
        Space.x3,
        Space.gutter,
        0,
      ),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const RarityTag(Rarity.ssr, dense: true),
                const SizedBox(width: 6),
                Text('천장', style: AppText.bodyStrong),
                const Spacer(),
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: '확정까지 '),
                      TextSpan(
                        text: '${formatNumber(remaining)}회',
                        style: AppText.num(AppText.bodyStrong).copyWith(
                          color: AppColors.raritySSRInk,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  style: AppText.callout,
                ),
              ],
            ),
            const SizedBox(height: 6),
            GlowMeter(progress: pity.progress, height: 6),
            Text(
              '${formatNumber(pity.drawsSinceTopTier)} / ${formatNumber(pity.threshold ?? 0)}회',
              style: AppText.num(AppText.caption),
            ),
          ],
        ),
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
