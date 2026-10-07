import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../../gacha/domain/gacha_models.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
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

  const _AsyncList({
    required this.loader,
    required this.itemBuilder,
    required this.emptyTitle,
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
    return RefreshIndicator(
      color: AppColors.ink,
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.only(bottom: Space.x8),
        itemCount: items.isEmpty ? 2 : items.length + 1,
        separatorBuilder: (_, i) => i == 0
            ? const SizedBox.shrink()
            : const Hairline(inset: Space.gutter),
        itemBuilder: (context, i) {
          if (i == 0) return widget.header ?? const SizedBox(height: Space.x2);
          if (items.isEmpty) {
            return EmptyView(
              icon: Icons.leaderboard_outlined,
              title: widget.emptyTitle,
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

class _RankNumber extends StatelessWidget {
  final int rank;
  const _RankNumber(this.rank);

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 28,
    child: Text(
      '$rank',
      style: AppText.num(AppText.headline).copyWith(
        fontWeight: FontWeight.w800,
        color: rank <= 3 ? AppColors.ink : AppColors.inkTertiary,
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
                  Text(u.nickname, style: AppText.bodyStrong),
                  const SizedBox(height: 2),
                  Text(
                    '뽑기 ${formatNumber(u.drawCount)}회',
                    style: AppText.num(AppText.caption),
                  ),
                ],
              ),
            ),
            Text(
              formatWon(u.totalValue),
              style: AppText.num(AppText.bodyStrong),
            ),
          ],
        ),
      ),
    );
  }
}

class _GachaTab extends StatelessWidget {
  const _GachaTab();
  static const _repo = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncList<GachaRankingItem>(
      loader: _repo.gachas,
      emptyTitle: '아직 순위가 없어요',
      header: const _Note('누적 뽑기 횟수 순이에요.'),
      itemBuilder: (context, g) => InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => GachaDetailPage(
              gacha: GachaSummary(
                id: g.gachaId,
                title: g.title,
                price: g.price,
                imageUrl: g.imageUrl,
              ),
            ),
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
                width: 56,
                height: 56,
                child: ProductImage(url: g.imageUrl),
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
                      style: AppText.bodyStrong,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '1회 ${formatGp(g.price)}',
                      style: AppText.num(AppText.caption),
                    ),
                  ],
                ),
              ),
              Text(
                '${formatNumber(g.drawCount)}회',
                style: AppText.num(AppText.bodyStrong),
              ),
            ],
          ),
        ),
      ),
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
      header: const _Note('최근 당첨 기록이에요. 닉네임 일부는 가려서 보여드려요.'),
      itemBuilder: (context, w) => Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.gutter,
          vertical: Space.x3,
        ),
        child: Row(
          children: [
            SizedBox(
              width: 48,
              height: 48,
              child: ProductImage(url: w.imageUrl),
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
                  style: AppText.num(
                    AppText.callout,
                  ).copyWith(color: AppColors.ink, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  w.relativeTimeLabel,
                  style: AppText.caption.copyWith(color: AppColors.inkTertiary),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
