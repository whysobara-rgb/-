import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../data/ranking_repository.dart';
import '../domain/ranking_models.dart';

/// 가치가차 - 랭킹 탭 메인 화면.
///
/// 3개 탭(유저 랭킹 / 인기 박스 / 실시간 당첨)으로 구성되며, 각각
/// 백엔드 `GET /rankings/users`, `/rankings/gachas`, `/rankings/wins`를
/// 실시간으로 조회해 표시한다.
class RankingScreen extends StatefulWidget {
  const RankingScreen({super.key});

  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        backgroundColor: AppColors.scaffoldBg,
        appBar: AppBar(
          backgroundColor: AppColors.scaffoldBg,
          elevation: 0,
          centerTitle: false,
          title: ShaderMask(
            shaderCallback: (bounds) => AppColors.goldGradient.createShader(
              Rect.fromLTWH(0, 0, bounds.width, bounds.height),
            ),
            child: const Text(
              '랭킹',
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          actions: const [GpBadge()],
          bottom: const TabBar(
            indicatorColor: AppColors.neonPrimary,
            indicatorWeight: 3,
            labelColor: AppColors.neonPrimary,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            unselectedLabelStyle: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
            tabs: [
              Tab(text: '유저 랭킹'),
              Tab(text: '인기 박스'),
              Tab(text: '실시간 당첨'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [_UserRankingTab(), _GachaRankingTab(), _WinFeedTab()],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 공통: 로딩/에러/빈 상태 래퍼
// ─────────────────────────────────────────────────────────────

typedef _Loader<T> = Future<List<T>> Function();

class _AsyncListView<T> extends StatefulWidget {
  final _Loader<T> loader;
  final Widget Function(BuildContext context, List<T> items) builder;
  final String emptyMessage;

  const _AsyncListView({
    required this.loader,
    required this.builder,
    this.emptyMessage = '데이터가 없습니다',
  });

  @override
  State<_AsyncListView<T>> createState() => _AsyncListViewState<T>();
}

class _AsyncListViewState<T> extends State<_AsyncListView<T>>
    with AutomaticKeepAliveClientMixin {
  List<T>? _items;
  bool _isLoading = true;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final items = await widget.loader();
      if (!mounted) return;
      setState(() {
        _items = items;
        _isLoading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = '데이터를 불러오지 못했습니다';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);

    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.neonPrimary),
      );
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline_rounded,
                size: 40,
                color: AppColors.textSecondary,
              ),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _load,
                child: const Text(
                  '다시 시도',
                  style: TextStyle(
                    color: AppColors.neonPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }
    final items = _items ?? [];
    if (items.isEmpty) {
      return Center(
        child: Text(
          widget.emptyMessage,
          style: const TextStyle(color: AppColors.textSecondary),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.neonPrimary,
      backgroundColor: AppColors.surfaceElevated,
      child: widget.builder(context, items),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 탭 1: 유저 랭킹
// ─────────────────────────────────────────────────────────────

class _UserRankingTab extends StatelessWidget {
  const _UserRankingTab();

  static const _repository = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncListView<UserRankingItem>(
      loader: _repository.getUserRankings,
      builder: (context, items) => ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        itemCount: items.length,
        separatorBuilder: (context, index) => const SizedBox(height: 10),
        itemBuilder: (context, index) => _UserRankRow(item: items[index]),
      ),
    );
  }
}

class _UserRankRow extends StatelessWidget {
  final UserRankingItem item;

  const _UserRankRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final isTop3 = item.rank <= 3;
    final rankColor = switch (item.rank) {
      1 => const Color(0xFFFFD54A),
      2 => const Color(0xFFD9D9E0),
      3 => const Color(0xFFCE8946),
      _ => AppColors.textSecondary,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isTop3
              ? rankColor.withValues(alpha: 0.4)
              : AppColors.surfaceBorder,
        ),
      ),
      child: Row(
        children: [
          // ── 순위 ──
          SizedBox(
            width: 32,
            child: isTop3
                ? Icon(Icons.emoji_events_rounded, color: rankColor, size: 26)
                : Text(
                    '${item.rank}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
          ),
          const SizedBox(width: 10),
          // ── 닉네임 + 뽑기 횟수 ──
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.nickname,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '누적 ${item.drawCount}회 뽑기',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          // ── 누적 획득 가치 ──
          Text(
            '${_formatNumber(item.totalValue)} GP',
            style: const TextStyle(
              color: AppColors.neonPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 탭 2: 인기 박스 랭킹
// ─────────────────────────────────────────────────────────────

class _GachaRankingTab extends StatelessWidget {
  const _GachaRankingTab();

  static const _repository = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncListView<GachaRankingItem>(
      loader: _repository.getGachaRankings,
      builder: (context, items) => ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        itemCount: items.length,
        separatorBuilder: (context, index) => const SizedBox(height: 10),
        itemBuilder: (context, index) => _GachaRankRow(item: items[index]),
      ),
    );
  }
}

class _GachaRankRow extends StatelessWidget {
  final GachaRankingItem item;

  const _GachaRankRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final isTop3 = item.rank <= 3;
    final rankColor = switch (item.rank) {
      1 => const Color(0xFFFFD54A),
      2 => const Color(0xFFD9D9E0),
      3 => const Color(0xFFCE8946),
      _ => AppColors.textSecondary,
    };
    final accentColor = _colorFromHex(item.accentColorHex);

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isTop3
              ? rankColor.withValues(alpha: 0.4)
              : AppColors.surfaceBorder,
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            child: isTop3
                ? Icon(Icons.emoji_events_rounded, color: rankColor, size: 22)
                : Text(
                    '${item.rank}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
          ),
          const SizedBox(width: 8),
          // ── 박스 썸네일 (실제 이미지) ──
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 56,
              height: 56,
              child: item.imageUrl != null
                  ? CachedNetworkImage(
                      imageUrl: item.imageUrl!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) =>
                          Container(color: AppColors.surfaceElevated2),
                      errorWidget: (context, url, error) => Container(
                        color: accentColor.withValues(alpha: 0.4),
                        child: const Icon(
                          Icons.card_giftcard_rounded,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : Container(
                      color: accentColor.withValues(alpha: 0.4),
                      child: const Icon(
                        Icons.card_giftcard_rounded,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '누적 ${item.drawCount}회 개봉',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          Text(
            '${_formatNumber(item.price)} GP',
            style: const TextStyle(
              color: AppColors.neonPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 탭 3: 실시간 당첨 피드
// ─────────────────────────────────────────────────────────────

class _WinFeedTab extends StatelessWidget {
  const _WinFeedTab();

  static const _repository = RankingRepository();

  @override
  Widget build(BuildContext context) {
    return _AsyncListView<WinFeedItem>(
      loader: _repository.getWinFeed,
      builder: (context, items) => ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        itemCount: items.length,
        separatorBuilder: (context, index) => const SizedBox(height: 10),
        itemBuilder: (context, index) => _WinFeedRow(item: items[index]),
      ),
    );
  }
}

class _WinFeedRow extends StatelessWidget {
  final WinFeedItem item;

  const _WinFeedRow({required this.item});

  Color _rarityColor(String rarity) {
    switch (rarity) {
      case 'SSR':
        return AppColors.raritySSR;
      case 'SR':
        return AppColors.raritySR;
      case 'R':
        return AppColors.rarityR;
      case 'N':
      default:
        return AppColors.rarityN;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _rarityColor(item.rarity);

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.surfaceBorder),
      ),
      child: Row(
        children: [
          // ── 아이템 썸네일 ──
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 52,
              height: 52,
              child: item.imageUrl != null
                  ? CachedNetworkImage(
                      imageUrl: item.imageUrl!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) =>
                          Container(color: AppColors.surfaceElevated2),
                      errorWidget: (context, url, error) => Container(
                        color: AppColors.surfaceElevated2,
                        child: Icon(
                          Icons.card_giftcard_rounded,
                          color: color,
                        ),
                      ),
                    )
                  : Container(
                      color: AppColors.surfaceElevated2,
                      child: Icon(Icons.card_giftcard_rounded, color: color),
                    ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(5),
                        border: Border.all(
                          color: color.withValues(alpha: 0.6),
                        ),
                      ),
                      child: Text(
                        item.rarity,
                        style: TextStyle(
                          color: color,
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        item.itemName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${item.nickname}님이 「${item.gachaTitle}」에서 획득',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${_formatNumber(item.estimatedValue)} GP',
                style: const TextStyle(
                  color: AppColors.neonPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                item.relativeTimeLabel,
                style: const TextStyle(
                  color: AppColors.textDisabled,
                  fontSize: 10,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────────

String _formatNumber(int value) {
  final str = value.toString();
  final buffer = StringBuffer();
  for (int i = 0; i < str.length; i++) {
    final posFromEnd = str.length - i;
    buffer.write(str[i]);
    if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
  }
  return buffer.toString();
}

Color _colorFromHex(String hex) {
  final cleaned = hex.replaceAll('#', '');
  final value = int.tryParse(cleaned, radix: 16) ?? 0x9AA0A6;
  return Color(0xFF000000 | value);
}
