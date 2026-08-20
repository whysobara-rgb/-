import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
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
/// "화이트 앱 셸 + 다크 프로모션 요소" 컨셉으로, 전체 배경은 화이트이며
/// 실시간 당첨 티커/메인 배너/랜덤박스 카드 등 프로모션 요소만 다크로
/// 구성된다.
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  // 추후 실제 API 연동 시 이 repository 구현만 교체하면 됨.
  final _repository = const CapsuleBoxRepository();

  CapsuleCategory _selectedCategory = CapsuleCategory.recommend;

  List<CapsuleBox> get _filteredBoxes =>
      _repository.getByCategory(_selectedCategory);

  void _onCategorySelected(CapsuleCategory category) {
    setState(() => _selectedCategory = category);
  }

  void _openDetail(CapsuleBox box) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => GachaDetailPage(box: box)));
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();

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
            icon: const Icon(Icons.search_rounded, color: Color(0xFF1A1A1A)),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(
              Icons.notifications_rounded,
              color: Color(0xFF1A1A1A),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // ── 유저 인사 + 포인트 (화이트 배경) ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '안녕하세요, 손귀성님!',
                      style: TextStyle(
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
            // childAspectRatio(가변 비율) 대신 고정 mainAxisExtent(고정 높이)를
            // 사용해, 화면 폭에 관계없이 카드 높이가 일정하게 유지되고
            // 썸네일(75%)/정보(25%) 영역이 항상 화면에 온전히 보이도록 함.
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              sliver: SliverGrid(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  mainAxisExtent: 220,
                ),
                delegate: SliverChildBuilderDelegate((context, index) {
                  final box = _filteredBoxes[index];
                  return CapsuleBoxCard(
                    key: ValueKey(box.id),
                    box: box,
                    onTap: () => _openDetail(box),
                  );
                }, childCount: _filteredBoxes.length),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
