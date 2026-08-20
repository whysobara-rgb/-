import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../inventory/domain/inventory_item.dart';
import '../../wallet/presentation/point_history_page.dart';

/// 가치가차 - 하단 탭 "마이" 화면.
///
/// 전체 배경은 화이트이며, 상단 프로필 카드만 darkSurface로 대비를 준다.
class ProfilePage extends StatelessWidget {
  /// "충전" 탭으로 이동하기 위한 콜백. [MainNavigation]에서 전달된다.
  final VoidCallback onGoToWallet;

  const ProfilePage({super.key, required this.onGoToWallet});

  void _openPointHistory(BuildContext context) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => const PointHistoryPage()));
  }

  void _showComingSoon(BuildContext context, String label) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label 기능은 아직 준비중입니다')));
  }

  void _confirmLogout(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            '로그아웃',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          content: const Text('로그아웃 하시겠습니까?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text(
                '취소',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                context.read<AuthProvider>().logout();
              },
              child: const Text(
                '로그아웃',
                style: TextStyle(
                  color: AppColors.error,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();

    // 활동 요약(뽑기횟수/보관상품수/배송완료수)에 사용되는 더미 데이터.
    // 추후 실제 API 연동 시 이 값들을 서버 응답으로 교체하면 됨.
    const inventoryRepository = InventoryRepository();
    final inventoryItems = inventoryRepository.getDummyItems();
    final storedCount = inventoryItems.length;
    final deliveredCount = inventoryItems
        .where((item) => item.status == InventoryStatus.delivered)
        .length;
    const totalDrawCount = 42;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: const Text(
          '마이',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // ── 상단 프로필 카드 (darkSurface, 마진 20) ──
            Container(
              margin: const EdgeInsets.all(20),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppColors.darkSurface,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          gradient: AppColors.goldGradient,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.person_rounded,
                          size: 30,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              '손귀성',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'sohn****@gachigacha.com',
                              style: TextStyle(
                                color: AppColors.textOnDarkSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    height: 1,
                    color: Colors.white.withValues(alpha: 0.1),
                  ),
                  const SizedBox(height: 16),
                  // ── GP 잔액 Row ──
                  Row(
                    children: [
                      const Text(
                        '보유 GP',
                        style: TextStyle(
                          color: AppColors.textOnDarkSecondary,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '${gp.formattedBalance} GP',
                        style: const TextStyle(
                          color: AppColors.goldPrimary,
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const Spacer(),
                      Material(
                        color: AppColors.goldPrimary,
                        borderRadius: BorderRadius.circular(20),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(20),
                          onTap: onGoToWallet,
                          child: const Padding(
                            padding: EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 6,
                            ),
                            child: Text(
                              '충전 탭 가기',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
              child: Column(
                children: [
                  // ── 활동 요약 Row (3분할) ──
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
                          blurRadius: 10,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: _StatColumn(
                            value: '$totalDrawCount',
                            label: '총 뽑기횟수',
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 32,
                          color: AppColors.surfaceBorder,
                        ),
                        Expanded(
                          child: _StatColumn(
                            value: '$storedCount',
                            label: '보관 상품수',
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 32,
                          color: AppColors.surfaceBorder,
                        ),
                        Expanded(
                          child: _StatColumn(
                            value: '$deliveredCount',
                            label: '배송완료수',
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 20),

                  // ── 메뉴 리스트 (섹션1: 내 활동) ──
                  _MenuSection(
                    title: '내 활동',
                    items: [
                      _MenuItemData(
                        icon: Icons.casino_rounded,
                        label: '뽑기내역',
                        onTap: () => _showComingSoon(context, '뽑기내역'),
                      ),
                      _MenuItemData(
                        icon: Icons.receipt_long_rounded,
                        label: '포인트내역',
                        onTap: () => _openPointHistory(context),
                      ),
                      _MenuItemData(
                        icon: Icons.local_shipping_rounded,
                        label: '배송조회',
                        onTap: () => _showComingSoon(context, '배송조회'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 16),

                  // ── 메뉴 리스트 (섹션2: 고객지원) ──
                  _MenuSection(
                    title: '고객지원',
                    items: [
                      _MenuItemData(
                        icon: Icons.campaign_rounded,
                        label: '공지사항',
                        onTap: () => _showComingSoon(context, '공지사항'),
                      ),
                      _MenuItemData(
                        icon: Icons.help_rounded,
                        label: 'FAQ',
                        onTap: () => _showComingSoon(context, 'FAQ'),
                      ),
                      _MenuItemData(
                        icon: Icons.support_agent_rounded,
                        label: '고객센터 문의',
                        onTap: () => _showComingSoon(context, '고객센터 문의'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 16),

                  // ── 메뉴 리스트 (섹션3: 설정) ──
                  _MenuSection(
                    title: '설정',
                    items: [
                      _MenuItemData(
                        icon: Icons.notifications_rounded,
                        label: '알림설정',
                        onTap: () => _showComingSoon(context, '알림설정'),
                      ),
                      _MenuItemData(
                        icon: Icons.logout_rounded,
                        label: '로그아웃',
                        isDestructive: true,
                        onTap: () => _confirmLogout(context),
                      ),
                    ],
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

/// 활동 요약 Row의 각 칸 (숫자 + 라벨).
class _StatColumn extends StatelessWidget {
  final String value;
  final String label;

  const _StatColumn({required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
      ],
    );
  }
}

/// 메뉴 항목 데이터.
class _MenuItemData {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool isDestructive;

  const _MenuItemData({
    required this.icon,
    required this.label,
    required this.onTap,
    this.isDestructive = false,
  });
}

/// 메뉴 리스트 섹션 (제목 + 화이트 카드).
class _MenuSection extends StatelessWidget {
  final String title;
  final List<_MenuItemData> items;

  const _MenuSection({required this.title, required this.items});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            children: [
              for (int i = 0; i < items.length; i++) ...[
                _MenuTile(data: items[i]),
                if (i != items.length - 1)
                  const Divider(
                    height: 1,
                    indent: 16,
                    endIndent: 16,
                    color: AppColors.surfaceBorder,
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// 메뉴 리스트 개별 항목 (골드 아이콘 + 메뉴명 + 화살표).
class _MenuTile extends StatelessWidget {
  final _MenuItemData data;

  const _MenuTile({required this.data});

  @override
  Widget build(BuildContext context) {
    final labelColor = data.isDestructive
        ? AppColors.error
        : AppColors.textPrimary;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: data.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(
                data.icon,
                size: 20,
                color: data.isDestructive
                    ? AppColors.error
                    : AppColors.goldPrimary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  data.label,
                  style: TextStyle(
                    color: labelColor,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (!data.isDestructive)
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: AppColors.textSecondary,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
