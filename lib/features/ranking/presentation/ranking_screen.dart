import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/theme/rarity_style.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/collectible_card.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../../gacha/data/gacha_repository.dart';
import '../../gacha/domain/gacha_models.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../../gacha/presentation/widgets/box_thumb.dart';
import '../data/ranking_repository.dart';
import '../domain/ranking_models.dart';

/// 랭킹 탭: 회원 순위 / 인기 박스 / 최근 당첨 기록.
class RankingScreen extends StatelessWidget {
  const RankingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('랭킹'),
          actions: const [GpBadge()],
          bottom: const PreferredSize(
            preferredSize: Size.fromHeight(44),
            child: TabBar(
              tabs: [
                Tab(text: '회원', height: 44),
                Tab(text: '인기 박스', height: 44),
                Tab(text: '최근 당첨', height: 44),
              ],
            ),
          ),
        ),
        body: const TabBarView(children: [_UserTab(), _GachaTab(), _WinsTab()]),
      ),
    );
  }
}

class _AsyncList<T> extends StatefulWidget {
  final Future<List<T>> Function() loader;
  final Widget? header;
  final Widget Function(BuildContext, T) itemBuilder;
  final String emptyTitle;
  final String? emptyMessage;
  final String? sparseNote;

  const _AsyncList({
    required this.loader,
    required this.itemBuilder,
    required this.emptyTitle,
    this.emptyMessage,
    this.sparseNote,
    this.header,
  });

  @override
  State<_AsyncList<T>> createState() => _AsyncListState<T>();
}

class _AsyncListState<T> extends State<_AsyncList<T>>
    with AutomaticKeepAliveClientMixin {
  List<T>? _items;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.loader();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.displayMessage);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final items = _items;
    if (_error != null && items == null) {
      return ErrorView(message: _error!, onRetry: _load);
    }
    if (items == null) return const LoadingView();
    final sparse = items.isNotEmpty && items.length < 5;
    return RefreshIndicator(
      color: AppColors.text,
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.only(bottom: Space.x8),
        // 기록이 적을 때는 마지막에 짧은 안내를 붙인다(빈칸을 가짜로 채우지 않는다).
        itemCount: items.isEmpty ? 2 : items.length + (sparse ? 2 : 1),
        separatorBuilder: (_, i) => i == 0
            ? const SizedBox.shrink()
            : const Hairline(inset: Space.gutter),
        itemBuilder: (context, i) {
          if (i == 0) return widget.header ?? const SizedBox(height: Space.x2);
          if (sparse && i == items.length + 1) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                Space.x5,
                Space.gutter,
                0,
              ),
              child: Text(
                widget.sparseNote ?? '기록이 쌓이면 더 채워져요.',
                style: AppText.caption.copyWith(color: AppColors.textTertiary),
              ),
            );
          }
          if (items.isEmpty) {
            return EmptyView(
              icon: Icons.leaderboard_outlined,
              title: widget.emptyTitle,
              message: widget.emptyMessage,
            );
          }
          return widget.itemBuilder(context, items[i - 1]);
        },
      ),
    );
  }
}

class _Note extends StatelessWidget {
  final String text;
  const _Note(this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      Space.gutter,
      Space.x4,
      Space.gutter,
      Space.x2,
    ),
    child: Text(text, style: AppText.caption),
  );
}

/// 순위 숫자: 굵은 이탤릭. 1위만 캡슐 레드, 2·3위 잉크, 그 아래 회색.
class _RankNumber extends StatelessWidget {
  final int rank;
  const _RankNumber(this.rank);

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 34,
    child: Text(
      '$rank',
      style: AppText.num(AppText.title1).copyWith(
        fontSize: 24,
        fontWeight: FontWeight.w900,
        fontStyle: FontStyle.italic,
        letterSpacing: -1,
        color: rank == 1
            ? AppColors.brand
            : rank <= 3
            ? AppColors.text
            : AppColors.textTertiary,
      ),
    ),
  );
}

class _UserTab extends StatelessWidget {
  const _UserTab();
  static const _repo = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncList<UserRankingItem>(
      loader: _repo.users,
      emptyTitle: '아직 순위가 없어요',
      emptyMessage: '박스를 연 기록이 생기면 여기에 순위가 매겨져요.',
      sparseNote: '실제 뽑기 기록만으로 순위를 매겨요. 기록이 쌓이면 더 채워져요.',
      header: const _Note('받은 상품의 정가 합계 순이에요.'),
      itemBuilder: (context, u) => Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.gutter,
          vertical: 14,
        ),
        child: Row(
          children: [
            _RankNumber(u.rank),
            const SizedBox(width: Space.x2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    u.nickname,
                    style: AppText.bodyStrong.copyWith(
                      color: AppColors.text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '뽑기 ${formatNumber(u.drawCount)}회',
                    style: AppText.num(AppText.caption),
                  ),
                ],
              ),
            ),
            PriceText(u.totalValue, unit: '원', size: 16),
          ],
        ),
      ),
    );
  }
}

class _GachaTab extends StatelessWidget {
  const _GachaTab();
  static const _repo = RankingRepository();
  static const _gachas = GachaRepository();

  /// 순위 + (판매 중이면) 박스 요약. 박스 요약이 있어야 그 박스의 패키지를
  /// 그릴 수 있다. 목록을 못 받으면 순위만 보여준다.
  static Future<List<(GachaRankingItem, GachaSummary?)>> _load() async {
    final ranking = await _repo.gachas();
    List<GachaSummary> boxes = const [];
    try {
      boxes = await _gachas.list();
    } catch (_) {}
    return [
      for (final g in ranking)
        (g, boxes.where((b) => b.id == g.gachaId).firstOrNull),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return _AsyncList<(GachaRankingItem, GachaSummary?)>(
      loader: _load,
      emptyTitle: '아직 순위가 없어요',
      emptyMessage: '박스를 연 기록이 생기면 여기에 순위가 매겨져요.',
      sparseNote: '실제 뽑기 기록만으로 순위를 매겨요. 기록이 쌓이면 더 채워져요.',
      header: const _Note('누적 뽑기 횟수 순이에요.'),
      itemBuilder: (context, entry) {
        final (g, box) = entry;
        final summary =
            box ??
            GachaSummary(
              id: g.gachaId,
              title: g.title,
              price: g.price,
              imageUrl: g.imageUrl,
              accent: g.accent,
            );
        return InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => GachaDetailPage(gacha: summary),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Space.gutter,
              vertical: Space.x3,
            ),
            child: Row(
              children: [
                _RankNumber(g.rank),
                const SizedBox(width: Space.x2),
                SizedBox(
                  width: 60,
                  height: 60,
                  child: DecoratedBox(
                    decoration: const BoxDecoration(
                      borderRadius: Radii.thumb,
                      boxShadow: Shadows.small,
                    ),
                    child: BoxThumb(
                      box: summary,
                      scale: 0.76,
                      borderRadius: Radii.thumb,
                    ),
                  ),
                ),
                const SizedBox(width: Space.x3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        g.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong.copyWith(
                          color: AppColors.text,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '1회 ${formatGp(g.price)}',
                        style: AppText.num(AppText.caption),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      formatNumber(g.drawCount),
                      style: AppText.num(AppText.headline).copyWith(
                        color: AppColors.text,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text('회 오픈', style: AppText.micro),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _WinsTab extends StatelessWidget {
  const _WinsTab();
  static const _repo = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncList<WinFeedItem>(
      loader: _repo.wins,
      emptyTitle: '최근 당첨 기록이 없어요',
      emptyMessage: '누군가 박스를 열면 여기에 바로 보여요.',
      sparseNote: '실제 당첨 기록만 보여드려요.',
      header: const _Note('최근 당첨 기록이에요. 닉네임 일부는 가려서 보여드려요.'),
      itemBuilder: (context, w) => Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.gutter,
          vertical: Space.x3,
        ),
        child: Row(
          children: [
            SizedBox(
              width: 52,
              height: 52,
              child: RarityFrame(
                rarity: w.rarity,
                radius: 11,
                glow: 0.6,
                child: ProductImage(
                  url: w.imageUrl,
                  rarity: w.rarity,
                  name: w.itemName,
                  borderRadius: BorderRadius.zero,
                ),
              ),
            ),
            const SizedBox(width: Space.x3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      RarityTag(w.rarity, dense: true),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          w.itemName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.bodyStrong,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${w.nickname} · ${w.gachaTitle}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption,
                  ),
                ],
              ),
            ),
            const SizedBox(width: Space.x2),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatWon(w.estimatedValue),
                  style: AppText.num(AppText.callout).copyWith(
                    color: w.rarity == Rarity.n ? AppColors.text : w.rarity.ink,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  w.relativeTimeLabel,
                  style: AppText.caption.copyWith(
                    color: AppColors.textTertiary,
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
