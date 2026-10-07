import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/ui.dart';
import '../../gacha/data/gacha_repository.dart';
import '../../gacha/domain/gacha_models.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../../rewards/presentation/attendance_card.dart';
import 'widgets/box_card.dart';
import 'widgets/featured_box.dart';

/// 홈.
///
/// 대표 박스 1개 → 출석체크 → 전체 박스 그리드 → 확률·한도 안내 순.
/// 서버가 주는 정보만 보여준다(가짜 당첨 티커·카운트다운 없음).
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

enum _Sort {
  recommended('추천순'),
  priceLow('낮은 가격순'),
  priceHigh('높은 가격순');

  const _Sort(this.label);
  final String label;
}

class _HomePageState extends State<HomePage> {
  static const _repository = GachaRepository();

  List<GachaSummary> _boxes = const [];
  bool _loading = true;
  String? _error;
  _Sort _sort = _Sort.recommended;
  int _refreshToken = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _boxes.isEmpty;
      _error = null;
      _refreshToken++;
    });
    try {
      final boxes = await _repository.list();
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

  GachaSummary? get _featured {
    if (_boxes.isEmpty) return null;
    final available = _boxes.where((b) => !b.soldOut).toList();
    if (available.isEmpty) return null;
    return available.firstWhere(
      (b) => b.badgeLabel?.toUpperCase() == 'SPECIAL',
      orElse: () => available.first,
    );
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
    }
    // 품절 박스는 정렬과 상관없이 맨 뒤로 (안정 정렬).
    return [...list.where((b) => !b.soldOut), ...list.where((b) => b.soldOut)];
  }

  void _open(GachaSummary box) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => GachaDetailPage(gacha: box)),
    );
  }

  @override
  Widget build(BuildContext context) {
    // 홈 탭을 다시 누르면 출석 상태를 새로 고친다.
    final homeRevision = context.select<TabNavigator, int>(
      (t) => t.revisionOf(AppTab.home),
    );
    final featured = _featured;

    return Scaffold(
      appBar: AppBar(title: const _Wordmark(), actions: const [GpBadge()]),
      body: RefreshIndicator(
        color: AppColors.ink,
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            if (_loading)
              const SliverToBoxAdapter(child: LoadingView(height: 480))
            else if (_error != null && _boxes.isEmpty)
              SliverToBoxAdapter(
                child: ErrorView(message: _error!, onRetry: _load, height: 480),
              )
            else ...[
              if (featured != null)
                SliverToBoxAdapter(
                  child: FeaturedBox(
                    box: featured,
                    onTap: () => _open(featured),
                  ),
                ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.gutter,
                    0,
                    Space.gutter,
                    Space.x6,
                  ),
                  child: AttendanceCard(
                    refreshToken: _refreshToken + homeRevision,
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SectionBand()),
              SliverToBoxAdapter(
                child: SectionHeader(
                  title: '전체 박스',
                  subtitle: '${_boxes.length}개',
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
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: Space.x3,
                    mainAxisSpacing: Space.x6,
                    childAspectRatio: 0.7,
                  ),
                  delegate: SliverChildBuilderDelegate((context, i) {
                    final box = _sorted[i];
                    return BoxCard(box: box, onTap: () => _open(box));
                  }, childCount: _boxes.length),
                ),
              ),
              const SliverToBoxAdapter(child: _TrustFooter()),
            ],
          ],
        ),
      ),
    );
  }
}

/// 워드마크: 잉크색 한글 로고타입 + 액센트 점 하나.
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
            style: TextStyle(color: AppColors.accent),
          ),
        ],
      ),
      style: AppText.title2.copyWith(
        fontSize: 21,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.9,
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
            _Chip(
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

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: const BorderRadius.all(Radius.circular(16)),
      child: AnimatedContainer(
        duration: Motion.fast,
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? AppColors.ink : AppColors.bg,
          border: Border.all(color: selected ? AppColors.ink : AppColors.line),
          borderRadius: const BorderRadius.all(Radius.circular(16)),
        ),
        child: Text(
          label,
          style: AppText.callout.copyWith(
            color: selected ? AppColors.onInk : AppColors.ink,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

/// 하단 안내: 확률 공개와 충전 한도로 가는 길을 항상 둔다.
class _TrustFooter extends StatelessWidget {
  const _TrustFooter();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.bgSubtle,
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x6,
        Space.gutter,
        Space.x8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('알고 뽑으세요', style: AppText.bodyStrong),
          const SizedBox(height: Space.x2),
          Text(
            keepAll(
              '모든 박스의 등급별·상품별 확률과 천장 규칙은 박스 상세의 '
              '‘확률 및 구성 정보’에서 볼 수 있어요.',
            ),
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x1),
          Text('한 달에 충전할 수 있는 금액을 직접 정해 둘 수 있어요.', style: AppText.caption),
          const SizedBox(height: Space.x3),
          OutlinedButton(
            onPressed: () =>
                context.read<TabNavigator>().goTo(context, AppTab.wallet),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 36),
              backgroundColor: AppColors.bg,
              textStyle: AppText.callout.copyWith(fontWeight: FontWeight.w600),
            ),
            child: const Text('월 충전 한도 설정'),
          ),
        ],
      ),
    );
  }
}
