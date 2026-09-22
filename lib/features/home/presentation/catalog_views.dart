import 'dart:async';
import 'package:flutter/material.dart';
import '../../../shared/widgets/gachi_components.dart';
import '../../customer_updates/customer_content.dart';
import '../../customer_updates/customer_updates_page.dart';
import '../../../shared/data/activity_page.dart';
import '../domain/capsule_box.dart';
import 'widgets/capsule_box_card.dart';

const catalogCategories = {
  'all': '전체',
  'tech': '테크',
  'home': '리빙',
  'luxury': '럭셔리',
  'fashion': '패션',
  'food': '푸드',
  'other': '기타',
};

class GachiCategoryTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelected;
  const GachiCategoryTabs({
    super.key,
    required this.selected,
    required this.onSelected,
  });
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: catalogCategories.entries
          .map(
            (e) => Padding(
              padding: const EdgeInsets.only(right: GachiSpace.sm),
              child: ChoiceChip(
                label: Text(
                  e.value,
                  style: GachiType.meta.copyWith(
                    fontWeight: FontWeight.w700,
                    color: selected == e.key
                        ? GachiColors.surface
                        : GachiColors.secondary,
                  ),
                ),
                selected: selected == e.key,
                showCheckmark: false,
                onSelected: (_) => onSelected(e.key),
              ),
            ),
          )
          .toList(),
    ),
  );
}

class CatalogGrid extends StatelessWidget {
  final List<CapsuleBox> boxes;
  final ValueChanged<CapsuleBox> onOpen;
  const CatalogGrid({super.key, required this.boxes, required this.onOpen});
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
      final columns = constraints.maxWidth < 300 || scale > 1.4 ? 1 : 2;
      final width =
          (constraints.maxWidth - (columns - 1) * GachiSpace.md) / columns;
      return Wrap(
        spacing: GachiSpace.md,
        runSpacing: GachiSpace.lg,
        children: boxes
            .map(
              (box) => SizedBox(
                width: width,
                child: CapsuleBoxCard(box: box, onTap: () => onOpen(box)),
              ),
            )
            .toList(),
      );
    },
  );
}

class CatalogBody extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<CapsuleBox> boxes;
  final bool filtered;
  final VoidCallback onRetry;
  final VoidCallback? onClear;
  final ValueChanged<CapsuleBox> onOpen;
  const CatalogBody({
    super.key,
    required this.loading,
    this.error,
    required this.boxes,
    this.filtered = false,
    required this.onRetry,
    this.onClear,
    required this.onOpen,
  });
  @override
  Widget build(BuildContext context) => loading
      ? const GachiLoadingState()
      : error != null
      ? GachiErrorState(message: error!, onRetry: onRetry)
      : boxes.isEmpty
      ? GachiEmptyState(
          title: filtered ? '검색 결과가 없어요' : '새로운 박스를 준비하고 있어요',
          message: filtered ? '다른 이름이나 카테고리로 찾아보세요.' : '잠시 후 다시 방문해주세요.',
          action: filtered && onClear != null
              ? TextButton(onPressed: onClear, child: const Text('전체 보기'))
              : null,
        )
      : CatalogGrid(boxes: boxes, onOpen: onOpen);
}

/// Presentation only. HomePage owns the single catalog request for both tabs.
class BoxShopScreen extends StatefulWidget {
  final List<CapsuleBox> boxes;
  final List<Campaign> campaigns;
  final String? contentError;
  final VoidCallback? onUpdates;
  final bool loading;
  final String? error;
  final String balance;
  final Widget? balanceNotice;
  final Future<void> Function() onRefresh;
  final ValueChanged<CapsuleBox> onOpen;
  final VoidCallback onWallet;
  const BoxShopScreen({
    super.key,
    required this.boxes,
    this.campaigns = const [],
    this.contentError,
    this.onUpdates,
    this.loading = false,
    this.error,
    this.balanceNotice,
    required this.balance,
    required this.onRefresh,
    required this.onOpen,
    required this.onWallet,
  });
  @override
  State<BoxShopScreen> createState() => _BoxShopScreenState();
}

class _BoxShopScreenState extends State<BoxShopScreen> {
  final _search = TextEditingController();
  String _sort = '기본순', _category = 'all';
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<CapsuleBox> get _visible {
    final query = _search.text.trim().toLowerCase();
    final result = widget.boxes
        .where(
          (b) =>
              b.name.toLowerCase().contains(query) &&
              (_category == 'all' || b.category == _category),
        )
        .toList();
    if (_sort == '낮은 가격순') {
      result.sort((a, b) => a.priceWon.compareTo(b.priceWon));
    }
    if (_sort == '높은 가격순') {
      result.sort((a, b) => b.priceWon.compareTo(a.priceWon));
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    return GachiScaffold(
      body: RefreshIndicator(
        onRefresh: widget.onRefresh,
        child: CustomScrollView(
          key: const PageStorageKey('v33-shop'),
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
              sliver: SliverList.list(
                children: [
                  GachiHeader(
                    balance: widget.balance,
                    onWallet: widget.onWallet,
                    onUpdates: widget.onUpdates,
                  ),
                  const SizedBox(height: GachiSpace.lg),
                  Text(
                    'BOX SHOP',
                    style: GachiType.english.copyWith(
                      color: GachiColors.secondary,
                    ),
                  ),
                  const SizedBox(height: GachiSpace.xs),
                  Semantics(
                    header: true,
                    child: const Text('박스샵', style: GachiType.pageTitle),
                  ),
                  const SizedBox(height: GachiSpace.xl),
                  if (widget.balanceNotice != null) widget.balanceNotice!,
                  if (widget.campaigns.isNotEmpty)
                    GachiCampaignPager(
                      campaigns: widget.campaigns,
                      onUpdates: widget.onUpdates,
                    ),
                  if (widget.contentError != null)
                    Text(widget.contentError!, style: GachiType.meta),
                  TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => FocusScope.of(context).unfocus(),
                    decoration: InputDecoration(
                      hintText: '박스 이름으로 검색',
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: '검색어 지우기',
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                  const SizedBox(height: GachiSpace.lg),
                  GachiCategoryTabs(
                    selected: _category,
                    onSelected: (value) => setState(() => _category = value),
                  ),
                  const SizedBox(height: GachiSpace.lg),
                  Wrap(
                    spacing: GachiSpace.sm,
                    runSpacing: GachiSpace.sm,
                    children: ['기본순', '낮은 가격순', '높은 가격순']
                        .map(
                          (label) => ChoiceChip(
                            label: Text(
                              label,
                              style: GachiType.meta.copyWith(
                                color: _sort == label
                                    ? GachiColors.surface
                                    : GachiColors.secondary,
                              ),
                            ),
                            selected: _sort == label,
                            showCheckmark: false,
                            onSelected: (_) => setState(() => _sort = label),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: GachiSpace.xl),
                  Text(
                    widget.loading ? '박스를 불러오고 있어요' : '박스 ${visible.length}개',
                    style: GachiType.meta,
                  ),
                  const SizedBox(height: GachiSpace.md),
                  CatalogBody(
                    loading: widget.loading,
                    error: widget.error,
                    boxes: visible,
                    filtered: _search.text.isNotEmpty || _category != 'all',
                    onRetry: widget.onRefresh,
                    onClear: () => setState(() {
                      _search.clear();
                      _category = 'all';
                    }),
                    onOpen: widget.onOpen,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  final List<CapsuleBox> boxes;
  final List<Campaign> campaigns;
  final String balance;
  final bool loading;
  final String? error, contentError;
  final Widget? balanceNotice;
  final Future<void> Function() onRefresh;
  final ValueChanged<CapsuleBox> onOpen;
  final VoidCallback onWallet, onShop, onRanking, onOpenUnopened, onCollection;
  final VoidCallback? onUpdates;
  const HomeScreen({
    super.key,
    required this.boxes,
    this.campaigns = const [],
    required this.balance,
    this.loading = false,
    this.error,
    this.contentError,
    this.balanceNotice,
    required this.onRefresh,
    required this.onOpen,
    required this.onWallet,
    required this.onShop,
    required this.onRanking,
    required this.onOpenUnopened,
    required this.onCollection,
    this.onUpdates,
  });
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _category = 'all';
  @override
  Widget build(BuildContext context) {
    final visible = widget.boxes
        .where((b) => _category == 'all' || b.category == _category)
        .toList();
    return GachiScaffold(
      body: RefreshIndicator(
        onRefresh: widget.onRefresh,
        child: CustomScrollView(
          key: const PageStorageKey('v33-home'),
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
              sliver: SliverList.list(
                children: [
                  GachiHeader(
                    balance: widget.balance,
                    onWallet: widget.onWallet,
                    onSearch: widget.onShop,
                    onUpdates: widget.onUpdates,
                  ),
                  if (widget.balanceNotice != null) widget.balanceNotice!,
                  GachiCategoryTabs(
                    selected: _category,
                    onSelected: (value) => setState(() => _category = value),
                  ),
                  const SizedBox(height: GachiSpace.lg),
                  if (widget.campaigns.isNotEmpty)
                    GachiCampaignPager(
                      campaigns: widget.campaigns,
                      onUpdates: widget.onUpdates,
                    )
                  else if (!widget.loading &&
                      widget.error == null &&
                      widget.boxes.isNotEmpty)
                    GachiCatalogHero(
                      box: widget.boxes.first,
                      onOpen: () => widget.onOpen(widget.boxes.first),
                    ),
                  if (widget.contentError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: GachiSpace.md),
                      child: Text(
                        widget.contentError!,
                        style: GachiType.meta.copyWith(
                          color: GachiColors.secondary,
                        ),
                      ),
                    ),
                  const SizedBox(height: GachiSpace.xl),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final columns =
                          MediaQuery.textScalerOf(context).scale(12) > 18
                          ? 2
                          : 4;
                      final entries = [
                        (Icons.storefront_outlined, '박스샵', widget.onShop),
                        (
                          Icons.inventory_2_outlined,
                          '미개봉',
                          widget.onOpenUnopened,
                        ),
                        (Icons.widgets_outlined, '보관함', widget.onCollection),
                        (Icons.leaderboard_outlined, '랭킹', widget.onRanking),
                      ];
                      return Wrap(
                        spacing: GachiSpace.sm,
                        runSpacing: GachiSpace.sm,
                        children: entries
                            .map(
                              (e) => SizedBox(
                                width:
                                    (constraints.maxWidth -
                                        (columns - 1) * GachiSpace.sm) /
                                    columns,
                                child: _QuickAction(
                                  icon: e.$1,
                                  label: e.$2,
                                  onTap: e.$3,
                                ),
                              ),
                            )
                            .toList(),
                      );
                    },
                  ),
                  const SizedBox(height: GachiSpace.section),
                  GachiSectionHeader(
                    title: '취향을 발견하는 박스',
                    onAction: widget.onShop,
                  ),
                  const SizedBox(height: GachiSpace.md),
                  CatalogBody(
                    loading: widget.loading,
                    error: widget.error,
                    boxes: visible.take(6).toList(),
                    filtered: _category != 'all',
                    onClear: () => setState(() => _category = 'all'),
                    onRetry: widget.onRefresh,
                    onOpen: widget.onOpen,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: GachiShape.card,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: const BoxDecoration(
                color: GachiColors.navy,
                borderRadius: GachiShape.card,
              ),
              child: Icon(icon, color: GachiColors.gold, size: GachiSize.icon),
            ),
            const SizedBox(height: GachiSpace.sm),
            Text(label, textAlign: TextAlign.center, style: GachiType.meta),
          ],
        ),
      ),
    ),
  );
}

class GachiCatalogHero extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onOpen;
  const GachiCatalogHero({super.key, required this.box, required this.onOpen});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(GachiSpace.xl),
    decoration: const BoxDecoration(
      color: GachiColors.navy,
      borderRadius: GachiShape.card,
    ),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final copy = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'GACHI DISCOVERY',
              style: GachiType.english.copyWith(color: GachiColors.gold),
            ),
            const SizedBox(height: GachiSpace.md),
            Text(
              box.name,
              style: GachiType.pageTitle.copyWith(color: GachiColors.ivory),
            ),
            const SizedBox(height: GachiSpace.md),
            Text(
              box.formattedPrice,
              style: GachiType.product.copyWith(color: GachiColors.ivory),
            ),
            const SizedBox(height: GachiSpace.xl),
            GachiPrimaryButton(
              label: '구성 상품 보기',
              onPressed: onOpen,
              gold: true,
            ),
          ],
        );
        if (box.imageUrl == null ||
            MediaQuery.textScalerOf(context).scale(15) > 21 ||
            constraints.maxWidth < 300) {
          return copy;
        }
        return Row(
          children: [
            Expanded(flex: 3, child: copy),
            const SizedBox(width: GachiSpace.md),
            Expanded(
              flex: 2,
              child: GachiProductImage(
                url: box.imageUrl,
                label: box.name,
                compact: true,
              ),
            ),
          ],
        );
      },
    ),
  );
}

/// Intrinsic campaign height; no clipped content when text is enlarged. Controls
/// and swipe preserve access to every published campaign even with motion off.
class GachiCampaignPager extends StatefulWidget {
  final List<Campaign> campaigns;
  final VoidCallback? onUpdates;
  const GachiCampaignPager({
    super.key,
    required this.campaigns,
    this.onUpdates,
  });
  @override
  State<GachiCampaignPager> createState() => _GachiCampaignPagerState();
}

class _GachiCampaignPagerState extends State<GachiCampaignPager>
    with WidgetsBindingObserver {
  Timer? _timer;
  int _index = 0;
  bool _paused = false, _foreground = true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _schedule();
  }

  @override
  void didUpdateWidget(covariant GachiCampaignPager oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.campaigns.map((c) => c.id).join() !=
        widget.campaigns.map((c) => c.id).join()) {
      _index = 0;
    }
    _schedule();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    if (!mounted ||
        _paused ||
        !_foreground ||
        widget.campaigns.length < 2 ||
        !TickerMode.of(context) ||
        MediaQuery.disableAnimationsOf(context) ||
        MediaQuery.accessibleNavigationOf(context)) {
      return;
    }
    _timer = Timer(const Duration(milliseconds: 2500), () {
      if (mounted) {
        _step(1);
      }
    });
  }

  void _step(int delta) {
    setState(() => _index = (_index + delta) % widget.campaigns.length);
    _schedule();
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final campaign = widget.campaigns[_index];
    return GestureDetector(
      onHorizontalDragEnd: (details) {
        if (details.primaryVelocity != null &&
            details.primaryVelocity!.abs() > 100) {
          _step(details.primaryVelocity! < 0 ? 1 : -1);
        }
      },
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(GachiSpace.xl),
            decoration: const BoxDecoration(
              color: GachiColors.navy,
              borderRadius: GachiShape.card,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'GACHI MOMENTS',
                  style: GachiType.english.copyWith(color: GachiColors.gold),
                ),
                const SizedBox(height: GachiSpace.md),
                Text(
                  campaign.title,
                  style: GachiType.pageTitle.copyWith(color: GachiColors.ivory),
                ),
                const SizedBox(height: GachiSpace.md),
                Text(
                  campaign.body,
                  style: GachiType.body.copyWith(color: GachiColors.ivory),
                ),
                if (campaign.imageUrl != null) ...[
                  const SizedBox(height: GachiSpace.lg),
                  GachiProductImage(
                    url: campaign.imageUrl,
                    label: campaign.title,
                    aspectRatio: 2,
                  ),
                ],
                const SizedBox(height: GachiSpace.md),
                Text(
                  '${activityDateLabel(campaign.startsAt)} ~ ${activityDateLabel(campaign.endsAt)}',
                  style: GachiType.meta.copyWith(color: GachiColors.ivory),
                ),
                const SizedBox(height: GachiSpace.lg),
                GachiPrimaryButton(
                  label: '이벤트 안내 전체 보기',
                  gold: true,
                  onPressed:
                      widget.onUpdates ??
                      () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const CustomerUpdatesPage(),
                        ),
                      ),
                ),
              ],
            ),
          ),
          if (widget.campaigns.length > 1)
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                IconButton(
                  tooltip: '이전 배너',
                  onPressed: () => _step(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                Text(
                  '${_index + 1} / ${widget.campaigns.length}',
                  style: GachiType.meta,
                ),
                IconButton(
                  tooltip: '다음 배너',
                  onPressed: () => _step(1),
                  icon: const Icon(Icons.chevron_right),
                ),
                IconButton(
                  tooltip: _paused ? '배너 자동 재생' : '배너 일시정지',
                  onPressed: () {
                    setState(() => _paused = !_paused);
                    _schedule();
                  },
                  icon: Icon(_paused ? Icons.play_arrow : Icons.pause),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
