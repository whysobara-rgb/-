import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../data/capsule_box_repository.dart';
import '../domain/capsule_box.dart';
import '../domain/capsule_category.dart';
import 'widgets/capsule_box_card.dart';
import 'widgets/category_filter_bar.dart';
import 'widgets/home_banner_carousel.dart';
import 'widgets/quick_menu_row.dart';
import 'widgets/winner_ticker.dart';

/// 가치가차 - 홈 탭 메인 화면.
///
/// "Vivid Pastel Pop" 컨셉으로, 전체 배경은 크림 화이트이며
/// 실시간 당첨 티커/메인 배너/랜덤박스 카드 등 프로모션 요소는
/// 코랄·바이올렛·민트·옐로우 등 비비드 그라디언트로 구성된다.
/// 랜덤박스 목록은 백엔드 GET /gachas에서 실시간으로 가져온다.
class HomePage extends StatefulWidget {
  /// "충전" 탭으로 이동하기 위한 콜백. [MainNavigation]에서 전달되며,
  /// [GachaDetailPage]에서 잔액 부족 시 충전 탭으로 넘어갈 때 사용된다.
  final VoidCallback onGoToWallet;

  const HomePage({super.key, required this.onGoToWallet});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _repository = const CapsuleBoxRepository();

  CapsuleCategory _selectedCategory = CapsuleCategory.recommend;

  List<CapsuleBox> _boxes = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadBoxes());
  }

  Future<void> _loadBoxes() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final boxes = await _repository.getByCategory(_selectedCategory);
      if (!mounted) return;
      setState(() {
        _boxes = boxes;
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
        _error = '랜덤박스 목록을 불러오지 못했습니다';
        _isLoading = false;
      });
    }
  }

  void _onCategorySelected(CapsuleCategory category) {
    setState(() => _selectedCategory = category);
    _loadBoxes();
  }

  void _openDetail(CapsuleBox box) {
    Navigator.of(context)
        .push(
          MaterialPageRoute(
            builder: (context) => GachaDetailPage(
              box: box,
              onGoToWallet: widget.onGoToWallet,
            ),
          ),
        )
        .then((_) {
          // 뽑기 후 돌아오면 잔액이 바뀌었을 수 있으므로 프로필을 새로고침한다.
          if (mounted) context.read<AuthProvider>().refreshProfile();
        });
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    final nickname = context.watch<AuthProvider>().currentUser?.nickname ?? '';

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: 16,
        title: ShaderMask(
          shaderCallback: (bounds) => AppColors.goldGradient.createShader(
            Rect.fromLTWH(0, 0, bounds.width, bounds.height),
          ),
          child: const Text(
            'GACHIGACHA',
            style: TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.5,
            ),
          ),
        ),
        actions: [
          IconButton(
            onPressed: () {},
            icon: const Icon(
              Icons.search_rounded,
              color: AppColors.textPrimary,
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(
              Icons.notifications_rounded,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadBoxes,
          child: CustomScrollView(
            slivers: [
              // ── 유저 인사 + 포인트 (화이트 배경) ──
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '안녕하세요, $nickname님!',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '보유 포인트: ${gp.formattedBalance} GP',
                        style: const TextStyle(
                          color: AppColors.goldPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // ── 실시간 당첨 티커 (다크 배너) ──
              const SliverToBoxAdapter(child: WinnerTicker()),

              const SliverToBoxAdapter(child: SizedBox(height: 16)),

              // ── 카테고리 필터 탭 (화이트 배경) ──
              SliverToBoxAdapter(
                child: CategoryFilterBar(
                  selected: _selectedCategory,
                  onSelected: _onCategorySelected,
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 16)),

              // ── 메인 배너 (다크 프로모션 카드) ──
              const SliverToBoxAdapter(child: HomeBannerCarousel()),
              const SliverToBoxAdapter(child: SizedBox(height: 20)),

              // ── 퀵메뉴 (원형 아이콘 5개) ──
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: QuickMenuRow(),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),

              // ── "인기 랜덤박스" 섹션 타이틀 ──
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        '인기 랜덤박스',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      GestureDetector(
                        onTap: () {},
                        child: const Text(
                          '더보기 >',
                          style: TextStyle(
                            color: AppColors.goldPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 12)),

              // ── 캡슐(랜덤박스) 카드 그리드 (다크 카드) ──
              if (_isLoading)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(
                      child: CircularProgressIndicator(
                        color: AppColors.goldPrimary,
                      ),
                    ),
                  ),
                )
              else if (_error != null)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 40,
                    ),
                    child: Column(
                      children: [
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextButton(
                          onPressed: _loadBoxes,
                          child: const Text('다시 시도'),
                        ),
                      ],
                    ),
                  ),
                )
              else if (_boxes.isEmpty)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(
                      child: Text(
                        '표시할 랜덤박스가 없습니다',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  sliver: SliverGrid(
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          mainAxisExtent: 220,
                        ),
                    delegate: SliverChildBuilderDelegate((context, index) {
                      final box = _boxes[index];
                      return CapsuleBoxCard(
                        key: ValueKey(box.id),
                        box: box,
                        onTap: () => _openDetail(box),
                      );
                    }, childCount: _boxes.length),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
