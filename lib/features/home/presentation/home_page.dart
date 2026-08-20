import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../data/capsule_box_repository.dart';
import '../domain/capsule_box.dart';
import '../domain/capsule_category.dart';
import 'widgets/capsule_box_card.dart';
import 'widgets/home_banner_carousel.dart';
import 'widgets/quick_menu_row.dart';

/// 가치가차 - 홈 탭 메인 화면.
///
/// "Claymorphism & Pastel 3D" 컨셉 - 크림 화이트 배경 위에 부드러운
/// 클레이 3D 그래픽과 소프트 드롭 섀도우를 사용해 아기자기하고 친근한
/// 캐주얼 가챠 앱의 아이덴티티를 구성한다.
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

  final CapsuleCategory _selectedCategory = CapsuleCategory.recommend;

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
    // AuthProvider는 다른 화면에서 갱신 시 GpBadge 등에 반영되도록 watch.
    context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: 16,
        title: const _ClayLogo(),
        actions: [
          const GpBadge(),
          _NotificationIconButton(onTap: () {}),
          IconButton(
            onPressed: () {},
            icon: const Icon(
              Icons.search_rounded,
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
              const SliverToBoxAdapter(child: SizedBox(height: 4)),

              // ── 메인 럭키 PICK 배너 (오가닉 멀티그라데이션 + 3D 캐릭터) ──
              const SliverToBoxAdapter(child: HomeBannerCarousel()),
              const SliverToBoxAdapter(child: SizedBox(height: 22)),

              // ── 퀵메뉴 (클레이 3D 원형 아이콘 5개) ──
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: QuickMenuRow(),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 26)),

              // ── 캡슐(랜덤박스) 카드 그리드 (화이트 라운드 카드 + 리본뱃지) ──
              if (_isLoading)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 60),
                    child: Center(
                      child: CircularProgressIndicator(
                        color: AppColors.primary,
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
                          mainAxisSpacing: 14,
                          crossAxisSpacing: 14,
                          mainAxisExtent: 232,
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

/// 클레이모피즘 스타일 GACHIGACHA 로고.
/// 오렌지→바이올렛 그라데이션 워드마크 + 우측 상단 반짝이는 스파클 효과.
class _ClayLogo extends StatelessWidget {
  const _ClayLogo();

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ShaderMask(
          shaderCallback: (bounds) => AppColors.logoGradient.createShader(
            Rect.fromLTWH(0, 0, bounds.width, bounds.height),
          ),
          child: const Text(
            'GACHIGACHA',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.2,
            ),
          ),
        ),
        Positioned(
          top: -4,
          right: -14,
          child: ShaderMask(
            shaderCallback: (bounds) => AppColors.logoGradient.createShader(
              Rect.fromLTWH(0, 0, bounds.width, bounds.height),
            ),
            child: const Icon(
              Icons.auto_awesome_rounded,
              color: Colors.white,
              size: 16,
            ),
          ),
        ),
      ],
    );
  }
}

/// 알림(종) 아이콘 + 우측 상단 빨간 뱃지 닷.
class _NotificationIconButton extends StatelessWidget {
  final VoidCallback onTap;

  const _NotificationIconButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          const Icon(
            Icons.notifications_none_rounded,
            color: AppColors.textPrimary,
          ),
          Positioned(
            top: -1,
            right: -1,
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: AppColors.error,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.scaffoldBg, width: 1.5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
