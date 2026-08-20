import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/gp_provider.dart';
import '../domain/point_history.dart';
import 'point_history_page.dart';

/// 가치가차 - 하단 탭 "충전" 화면.
///
/// ※ 기획 정책상 유료 포인트 충전 기능은 제공하지 않는다.
/// 이 화면은 실제 결제/충전이 아니라 "GP 현황 확인 + 이용 내역 확인 +
/// 랜덤박스 구매 유도" 역할을 한다.
class WalletPage extends StatelessWidget {
  /// "랜덤박스 구매하러 가기" 탭 시 하단 네비게이션을 홈(0번) 탭으로
  /// 전환하기 위한 콜백. [MainNavigation]에서 전달된다.
  final VoidCallback onGoToHome;

  const WalletPage({super.key, required this.onGoToHome});

  void _openHistory(BuildContext context) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => const PointHistoryPage()));
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    final repository = const PointHistoryRepository();
    final recentHistory = repository.getDummyHistory().take(5).toList();

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: const Text(
          '충전',
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
            // ── 상단 GP 카드 (darkSurface 그라데이션, 마진 20) ──
            Container(
              margin: const EdgeInsets.all(20),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppColors.darkSurface,
                    AppColors.darkSurface.withValues(alpha: 0.85),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '손귀성님의 보유 포인트',
                    style: TextStyle(color: Colors.white, fontSize: 14),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${gp.formattedBalance} GP',
                    style: const TextStyle(
                      color: AppColors.goldPrimary,
                      fontSize: 32,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: onGoToHome,
                      style: TextButton.styleFrom(
                        padding: EdgeInsets.zero,
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text(
                        '랜덤박스 구매하러 가기 →',
                        style: TextStyle(
                          color: AppColors.goldPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ── 최근 포인트 내역 (화이트) ──
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        '최근 포인트 내역',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      GestureDetector(
                        onTap: () => _openHistory(context),
                        child: const Text(
                          '전체보기 >',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

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
                    child: ListView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: EdgeInsets.zero,
                      itemCount: recentHistory.length,
                      itemBuilder: (context, index) {
                        final entry = recentHistory[index];
                        return Column(
                          children: [
                            _HistoryPreviewTile(entry: entry),
                            if (index != recentHistory.length - 1)
                              const Divider(
                                height: 1,
                                indent: 16,
                                endIndent: 16,
                                color: AppColors.surfaceBorder,
                              ),
                          ],
                        );
                      },
                    ),
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

/// 포인트 내역 미리보기에 사용되는 리스트 항목.
/// 아이콘(획득=골드원형+, 사용=회색원형-) / 내용 / 날짜 / 금액.
class _HistoryPreviewTile extends StatelessWidget {
  final PointHistoryEntry entry;

  const _HistoryPreviewTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isEarn = entry.type == PointHistoryType.earn;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: isEarn
                  ? AppColors.goldPrimary.withValues(alpha: 0.15)
                  : AppColors.surfaceElevated,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              isEarn ? '+' : '-',
              style: TextStyle(
                color: isEarn ? AppColors.goldPrimary : AppColors.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.description,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  entry.formattedDate,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Text(
            entry.formattedAmount,
            style: TextStyle(
              color: entry.type.amountColor,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
