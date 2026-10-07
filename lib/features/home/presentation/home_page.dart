import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/ui.dart';
import '../../gacha/data/gacha_repository.dart';
import '../../gacha/domain/gacha_models.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../../gacha/presentation/odds_index_page.dart';
import '../../gacha/presentation/odds_page.dart';
import '../../ranking/data/ranking_repository.dart';
import '../../ranking/domain/ranking_models.dart';
import '../../rewards/presentation/attendance_card.dart';
import '../data/banner_repository.dart';
import '../domain/home_banner.dart';
import 'widgets/box_card.dart';
import 'widgets/hero_carousel.dart';
import 'widgets/win_ticker.dart';

/// 홈.
///
/// 배너 캐러셀(`/banners`) → 최근 SR+ 당첨 티커(`/rankings/wins`) → 출석체크 →
/// 마감 임박(실재고 70%↑) → 인기 박스(`/rankings/gachas`) → 전체 박스.
/// 모든 섹션은 서버 데이터만 그리고, 데이터가 없으면 섹션째 숨긴다
/// (가짜 당첨·카운트다운·시청자 수 없음).
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

enum _Sort {
  recommended('추천순'),
  priceLow('낮은 가격순'),
  priceHigh('높은 가격순'),
  prizeHigh('최대 경품순');

  const _Sort(this.label);
  final String label;
}

class _HomePageState extends State<HomePage> {
  static const _gachas = GachaRepository();
  static const _banners = BannerRepository();
  static const _rankings = RankingRepository();

  List<GachaSummary> _boxes = const [];
  List<HomeBanner> _bannerList = const [];
  List<WinFeedItem> _wins = const [];
  List<GachaRankingItem> _popular = const [];
  bool _loading = true;
  String? _error;
  _Sort _sort = _Sort.recommended;
  int _refreshToken = 0;
  Timer? _winPoll;
  final _attendanceKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _load();
    // 당첨 티커는 1분마다 새 기록을 가져온다(실제 기록만).
    _winPoll = Timer.periodic(const Duration(minutes: 1), (_) => _loadWins());
  }

  @override
  void dispose() {
    _winPoll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _boxes.isEmpty;
      _error = null;
      _refreshToken++;
    });
    await Future.wait([
      _loadBoxes(),
      _loadBanners(),
      _loadWins(),
      _loadPopular(),
    ]);
  }

  Future<void> _loadBoxes() async {
    try {
      final boxes = await _gachas.list();
      if (!mounted) return;
      setState(() {
        _boxes = boxes;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.displayMessage;
        _loading = false;
      });
    }
  }

  Future<void> _loadBanners() async {
    final banners = await _banners.list();
    if (mounted) setState(() => _bannerList = banners);
  }

  Future<void> _loadWins() async {
    try {
      final wins = await _rankings.wins();
      if (mounted) setState(() => _wins = WinTicker.pick(wins));
    } catch (_) {
      // 티커만 숨긴다.
    }
  }

  Future<void> _loadPopular() async {
    try {
      final items = await _rankings.gachas();
      if (mounted) setState(() => _popular = items);
    } catch (_) {}
  }

  GachaSummary? _boxById(int id) {
    for (final b in _boxes) {
      if (b.id == id) return b;
    }
    return null;
  }

  List<GachaSummary> get _sorted {
    final list = [..._boxes];
    switch (_sort) {
      case _Sort.recommended:
        break;
      case _Sort.priceLow:
        list.sort((a, b) => a.price.compareTo(b.price));
      case _Sort.priceHigh:
        list.sort((a, b) => b.price.compareTo(a.price));
      case _Sort.prizeHigh:
        list.sort(
          (a, b) => (b.topPrize?.estimatedValue ?? 0).compareTo(
            a.topPrize?.estimatedValue ?? 0,
          ),
        );
    }
    // 품절 박스는 정렬과 상관없이 맨 뒤로 (안정 정렬).
    return [...list.where((b) => !b.soldOut), ...list.where((b) => b.soldOut)];
  }

  List<GachaSummary> get _endingSoon =>
      _boxes.where((b) => b.isEndingSoon()).toList()
        ..sort((a, b) => (b.soldRatio ?? 0).compareTo(a.soldRatio ?? 0));

  /// 인기 순위 중 지금 판매 중인 박스만.
  List<(GachaRankingItem, GachaSummary)> get _popularBoxes => [
    for (final item in _popular)
      if (_boxById(item.gachaId) case final box?) (item, box),
  ];

  void _open(GachaSummary box) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => GachaDetailPage(gacha: box)),
    );
  }

  Future<void> _onBanner(HomeBanner b) async {
    switch (b.linkType) {
      case BannerLinkType.gacha:
        final id = b.gachaId;
        if (id == null) return;
        _open(_boxById(id) ?? GachaSummary(id: id, title: b.title, price: 0));
      case BannerLinkType.attendance:
        final ctx = _attendanceKey.currentContext;
        if (ctx != null) {
          await Scrollable.ensureVisible(
            ctx,
            duration: const Duration(milliseconds: 450),
            curve: Curves.easeOutCubic,
            alignment: 0.3,
          );
        }
      case BannerLinkType.topup:
        context.read<TabNavigator>().openTopup(context);
      case BannerLinkType.odds:
        final id = b.gachaId;
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => id == null
                ? const OddsIndexPage()
                : OddsPage(
                    gacha:
                        _boxById(id) ??
                        GachaSummary(id: id, title: '', price: 0),
                  ),
          ),
        );
      case BannerLinkType.url:
        final uri = b.url;
        if (uri == null) return;
        final ok = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
        if (!ok && mounted) showToast(context, '링크를 열지 못했어요');
      case BannerLinkType.none:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    // 홈 탭을 다시 누르면 출석 상태를 새로 고친다.
    final homeRevision = context.select<TabNavigator, int>(
      (t) => t.revisionOf(AppTab.home),
    );
    final ending = _endingSoon;
    final popular = _popularBoxes;
    final sorted = _sorted;

    return Scaffold(
      body: RefreshIndicator(
        color: AppColors.brand,
        backgroundColor: AppColors.raised,
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            const SliverAppBar(
              pinned: true,
              title: _Wordmark(),
              actions: [GpBadge()],
            ),
            if (_loading)
              const SliverToBoxAdapter(child: LoadingView(height: 480))
            else if (_error != null && _boxes.isEmpty)
              SliverToBoxAdapter(
                child: ErrorView(message: _error!, onRetry: _load, height: 480),
              )
            else ...[
              if (_bannerList.isNotEmpty)
                SliverToBoxAdapter(
                  child: HeroCarousel(
                    banners: _bannerList,
                    onTap: _onBanner,
                    categoryOf: (id) => _boxById(id)?.category,
                  ),
                ),
              if (_wins.isNotEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: Space.x2),
                    child: WinTicker(
                      wins: _wins,
                      onTap: () =>
                          context.read<TabNavigator>().select(AppTab.ranking),
                    ),
                  ),
                ),
              // 박스 바로가기: 판매 중인 모든 박스의 패키지 레일.
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 100,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(
                      Space.gutter - 2,
                      Space.x2,
                      Space.gutter - 2,
                      0,
                    ),
                    itemCount: _boxes.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 6),
                    itemBuilder: (context, i) => BoxShortcut(
                      box: _boxes[i],
                      onTap: () => _open(_boxes[i]),
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  key: _attendanceKey,
                  padding: const EdgeInsets.fromLTRB(
                    Space.gutter,
                    Space.x3,
                    Space.gutter,
                    Space.x2,
                  ),
                  child: AttendanceCard(
                    refreshToken: _refreshToken + homeRevision,
                  ),
                ),
              ),
              if (ending.isNotEmpty)
                SliverToBoxAdapter(
                  child: Container(
                    margin: const EdgeInsets.only(top: Space.x5),
                    padding: const EdgeInsets.only(bottom: Space.x5),
                    color: AppColors.brandSoft,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SectionHeader(
                          eyebrow: 'ENDING SOON',
                          title: '마감 임박',
                          subtitle: '실재고 70% 이상 판매된 박스',
                          padding: EdgeInsets.fromLTRB(
                            Space.gutter,
                            Space.x5,
                            Space.gutter,
                            Space.x3,
                          ),
                        ),
                        SizedBox(
                          height: 112,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            padding: Space.page,
                            clipBehavior: Clip.none,
                            itemCount: ending.length,
                            separatorBuilder: (_, _) =>
                                const SizedBox(width: Space.x3),
                            itemBuilder: (context, i) => SizedBox(
                              width: ending.length == 1 ? 350 : 296,
                              child: EndingSoonCard(
                                box: ending[i],
                                onTap: () => _open(ending[i]),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (popular.isNotEmpty) ...[
                SliverToBoxAdapter(
                  child: SectionHeader(
                    title: '인기 박스',
                    subtitle: '누적 오픈 수 기준',
                    actionLabel: '랭킹',
                    onAction: () =>
                        context.read<TabNavigator>().select(AppTab.ranking),
                    padding: const EdgeInsets.fromLTRB(
                      Space.gutter,
                      Space.x6,
                      Space.gutter,
                      Space.x3,
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 224,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: Space.page,
                      clipBehavior: Clip.none,
                      itemCount: popular.length.clamp(0, 10),
                      separatorBuilder: (_, _) =>
                          const SizedBox(width: Space.x3),
                      itemBuilder: (context, i) {
                        final (item, box) = popular[i];
                        return PopularRankCard(
                          rank: i + 1,
                          box: box,
                          drawCount: item.drawCount,
                          onTap: () => _open(box),
                        );
                      },
                    ),
                  ),
                ),
              ],
              // 전체 박스: 옅은 회색 띠 위에 흰 카드.
              DecoratedSliver(
                decoration: const BoxDecoration(color: AppColors.section),
                sliver: SliverMainAxisGroup(
                  slivers: [
                    SliverToBoxAdapter(
                      child: SectionHeader(
                        title: '전체 박스',
                        subtitle: '${_boxes.length}개 · 모든 확률 공개',
                        actionLabel: '확률 보기',
                        onAction: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const OddsIndexPage(),
                          ),
                        ),
                        padding: const EdgeInsets.fromLTRB(
                          Space.gutter,
                          Space.x6,
                          Space.gutter,
                          Space.x3,
                        ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: _SortBar(
                        value: _sort,
                        onChanged: (s) => setState(() => _sort = s),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(
                        Space.gutter,
                        Space.x4,
                        Space.gutter,
                        Space.x8,
                      ),
                      sliver: SliverGrid(
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              crossAxisSpacing: Space.x3,
                              mainAxisSpacing: Space.x3,
                              mainAxisExtent: 300,
                            ),
                        delegate: SliverChildBuilderDelegate((context, i) {
                          final box = sorted[i];
                          return BoxCard(box: box, onTap: () => _open(box));
                        }, childCount: sorted.length),
                      ),
                    ),
                    const SliverToBoxAdapter(child: _TrustFooter()),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 워드마크: 굵은 한글 로고타입 + 레드 점.
class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      const TextSpan(
        children: [
          TextSpan(text: '가치가차'),
          TextSpan(
            text: '.',
            style: TextStyle(color: AppColors.brand),
          ),
        ],
      ),
      style: AppText.title2.copyWith(
        fontSize: 23,
        fontWeight: FontWeight.w900,
        letterSpacing: -1.2,
        color: AppColors.text,
      ),
    );
  }
}

class _SortBar extends StatelessWidget {
  final _Sort value;
  final ValueChanged<_Sort> onChanged;

  const _SortBar({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: Space.page,
      child: Row(
        children: [
          for (final s in _Sort.values) ...[
            AppChip(
              label: s.label,
              selected: s == value,
              onTap: () => onChanged(s),
            ),
            const SizedBox(width: 6),
          ],
        ],
      ),
    );
  }
}

/// 하단 안내: 확률 공개와 충전 한도로 가는 길을 항상 둔다.
class _TrustFooter extends StatelessWidget {
  const _TrustFooter();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x10,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '알고 뽑으세요',
            style: AppText.headline.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: Space.x1),
          Text(
            '모든 박스의 등급별·상품별 확률과 천장 규칙을 공개하고, 한 달 충전 금액을 직접 정해 둘 수 있어요.',
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x3),
          Row(
            children: [
              Expanded(
                child: _FooterTile(
                  icon: Icons.percent_rounded,
                  label: '확률 및 구성 정보',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const OddsIndexPage(),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: Space.x2),
              Expanded(
                child: _FooterTile(
                  icon: Icons.speed_rounded,
                  label: '월 충전 한도',
                  onTap: () =>
                      context.read<TabNavigator>().goTo(context, AppTab.wallet),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FooterTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _FooterTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      borderRadius: Radii.button,
      shadow: Shadows.small,
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.brand),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: AppText.caption.copyWith(
                color: AppColors.text,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }
}
