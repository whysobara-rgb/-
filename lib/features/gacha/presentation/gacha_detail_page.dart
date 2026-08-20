import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../home/domain/capsule_box.dart';
import 'gacha_animation_page.dart';

/// 가치가차 - 캡슐(랜덤박스) 상세 화면.
///
/// "화이트 앱 셸 + 다크 프로모션 요소" 컨셉으로, 전체 배경은 화이트이며
/// 상단 비주얼 배너와 LUCKY LINEUP 카드만 다크로 구성된다.
/// 홈 화면 카드 탭 시 push되는 화면.
class GachaDetailPage extends StatefulWidget {
  final CapsuleBox box;

  /// "충전" 탭으로 이동하기 위한 콜백. 잔액 부족 시 충전 유도 다이얼로그에서
  /// "충전하러 가기"를 누르면 이 화면을 닫고 충전 탭으로 전환한다.
  final VoidCallback onGoToWallet;

  const GachaDetailPage({
    super.key,
    required this.box,
    required this.onGoToWallet,
  });

  @override
  State<GachaDetailPage> createState() => _GachaDetailPageState();
}

/// LUCKY LINEUP에 노출되는 더미 상품 라인업 아이템.
///
/// ※ 실제 브랜드명(에르메스/롤렉스/샤넬 등)은 라이선스 확인 전까지
/// 사용하지 않고, 일반명사로만 표기한다.
class _LineupItem {
  final IconData icon;
  final String name;
  final String description;

  const _LineupItem({
    required this.icon,
    required this.name,
    required this.description,
  });
}

class _GachaDetailPageState extends State<GachaDetailPage> {
  // 더미 재고/판매 현황 (추후 실제 API 연동 시 교체).
  static const int _totalStock = 10000;
  static const int _soldStock = 550;

  static const List<_LineupItem> _lineup = [
    _LineupItem(
      icon: Icons.phone_iphone,
      name: '프리미엄 스마트폰',
      description: '최신 모델',
    ),
    _LineupItem(
      icon: Icons.shopping_bag,
      name: '럭셔리 핸드백',
      description: '명품 브랜드',
    ),
    _LineupItem(
      icon: Icons.watch_rounded,
      name: '명품 시계',
      description: '스위스 브랜드',
    ),
    _LineupItem(icon: Icons.diamond, name: '프리미엄 액세서리', description: '한정판'),
  ];

  int _quantity = 1;
  static const int _maxQuantity = 100;

  double get _soldRatio => _soldStock / _totalStock;

  void _setQuantity(int value) {
    setState(() {
      _quantity = value.clamp(1, _maxQuantity);
    });
  }

  void _incrementBy(int amount) => _setQuantity(_quantity + amount);

  void _reset() => _setQuantity(1);

  int get _totalPrice => widget.box.priceWon * _quantity;

  /// 구매 버튼 클릭 시 흐름:
  /// 1) 잔액 부족 → "충전하러 가시겠습니까?" 다이얼로그 → 확인 시 이 화면을 닫고
  ///    충전 탭으로 이동.
  /// 2) 잔액 충분 → 구매 확인 다이얼로그 → 확인 시에만 뽑기 애니메이션 화면으로 이동.
  Future<void> _onPurchasePressed(CapsuleBox box) async {
    final gp = context.read<GpProvider>();
    final balance = gp.balance;

    if (balance < _totalPrice) {
      final shortfall = _totalPrice - balance;
      final goToWallet = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            '포인트가 부족합니다',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          content: Text(
            '현재 보유 GP: ${gp.formattedBalance} GP\n'
            '필요 GP: $_formattedTotalPrice\n'
            '부족한 GP: ${_formatAmount(shortfall)} GP\n\n'
            '포인트를 충전하러 가시겠습니까?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text(
                '취소',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text(
                '충전하러 가기',
                style: TextStyle(
                  color: AppColors.goldPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );

      if (goToWallet == true && mounted) {
        Navigator.of(context).pop(); // 상세 화면 닫고
        widget.onGoToWallet(); // 충전 탭으로 전환
      }
      return;
    }

    // 잔액 충분 → 구매 확인 다이얼로그.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          '랜덤박스 구매',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        content: Text(
          '${box.name} $_quantity개를 $_formattedTotalPrice에 구매하시겠습니까?\n'
          '(구매 후 즉시 개봉됩니다)',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text(
              '취소',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(
              '구매하기',
              style: TextStyle(
                color: AppColors.goldPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => GachaAnimationPage(box: box, count: _quantity),
        ),
      );
    }
  }

  String _formatAmount(int amount) {
    final str = amount.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return buffer.toString();
  }

  String get _formattedTotalPrice {
    final str = _totalPrice.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '₩${buffer.toString()}';
  }

  @override
  Widget build(BuildContext context) {
    final box = widget.box;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(
            Icons.arrow_back_ios_new_rounded,
            color: AppColors.textPrimary,
            size: 20,
          ),
        ),
        centerTitle: true,
        title: ShaderMask(
          shaderCallback: (bounds) => AppColors.goldGradient.createShader(
            Rect.fromLTWH(0, 0, bounds.width, bounds.height),
          ),
          child: const Text(
            'GACHIGACHA',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.5,
            ),
          ),
        ),
        actions: [
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.share_rounded, color: AppColors.textPrimary),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // ── [2] 상단 비주얼 배너 (다크) ──
                    _VisualBanner(box: box),

                    // ── [3] 가격 (화이트, 중앙 정렬) ──
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: Text(
                          box.formattedPrice,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),

                    // ── [4] 총 개수 카드 (화이트 카드) ──
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _StockCard(
                        totalStock: _totalStock,
                        soldStock: _soldStock,
                        ratio: _soldRatio,
                      ),
                    ),

                    const SizedBox(height: 16),

                    // ── [5] 안내 문구 ──
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '※ 개봉 후 환불 불가',
                            style: TextStyle(
                              color: AppColors.badgeSpecial,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '※ 재고 소진 시 조기 종료 가능',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 24),

                    // ── [6] LUCKY LINEUP (다크 카드) ──
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _LuckyLineupCard(items: _lineup),
                    ),

                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ),

            // ── [7] 하단 고정 수량선택 + 구매 버튼 ──
            _BottomPurchaseBar(
              quantity: _quantity,
              maxQuantity: _maxQuantity,
              totalPriceLabel: _formattedTotalPrice,
              onDecrement: () => _setQuantity(_quantity - 1),
              onIncrement: () => _setQuantity(_quantity + 1),
              onAdd10: () => _incrementBy(10),
              onAdd100: () => _incrementBy(100),
              onMax: () => _setQuantity(_maxQuantity),
              onReset: _reset,
              onPurchase: () => _onPurchasePressed(box),
            ),
          ],
        ),
      ),
    );
  }
}

/// [2] 상단 비주얼 배너 (다크 배경 + 큰 상품 아이콘 + 뱃지).
class _VisualBanner extends StatelessWidget {
  final CapsuleBox box;

  const _VisualBanner({required this.box});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 220,
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            box.accentColor.withValues(alpha: 0.55),
            AppColors.darkSurface,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: Center(
              child: Icon(box.icon, size: 100, color: Colors.white),
            ),
          ),
          // 좌하단 "오늘의 럭키 PICK!"
          const Positioned(
            left: 20,
            bottom: 20,
            child: Text(
              '오늘의\n럭키 PICK!',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w900,
                height: 1.3,
              ),
            ),
          ),
          // 우하단 뱃지 (SPECIAL/NEW)
          if (box.badgeLabel != null)
            Positioned(
              right: 20,
              bottom: 20,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: box.badgeLabel == 'NEW'
                      ? AppColors.badgeNew
                      : AppColors.badgeSpecial,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  box.badgeLabel!,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// [4] 총 개수 카드 (화이트, 진행률 표시).
class _StockCard extends StatelessWidget {
  final int totalStock;
  final int soldStock;
  final double ratio;

  const _StockCard({
    required this.totalStock,
    required this.soldStock,
    required this.ratio,
  });

  @override
  Widget build(BuildContext context) {
    final percentLabel = '${(ratio * 100).toStringAsFixed(1)}%';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.inventory_2_rounded,
                color: AppColors.goldPrimary,
                size: 22,
              ),
              const SizedBox(width: 8),
              Text(
                '$soldStock / $totalStock',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: AppColors.goldPrimary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  percentLabel,
                  style: const TextStyle(
                    color: AppColors.goldSecondary,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 8,
              backgroundColor: const Color(0xFFE5E5E5),
              valueColor: const AlwaysStoppedAnimation<Color>(
                AppColors.goldPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// [6] LUCKY LINEUP (다크 카드 + 가로 스크롤 아이템).
class _LuckyLineupCard extends StatelessWidget {
  final List<_LineupItem> items;

  const _LuckyLineupCard({required this.items});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.darkSurface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          const Text(
            '★ LUCKY LINEUP ★',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.goldPrimary,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 120,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: items.length,
              separatorBuilder: (context, index) => const SizedBox(width: 16),
              itemBuilder: (context, index) {
                final item = items[index];
                return SizedBox(
                  width: 88,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.start,
                    children: [
                      Icon(item.icon, size: 52, color: AppColors.goldPrimary),
                      const SizedBox(height: 8),
                      Text(
                        item.name,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.description,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textOnDarkSecondary,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// [7] 하단 고정 영역: 컴팩트 수량선택 Row + 구매 버튼.
class _BottomPurchaseBar extends StatelessWidget {
  final int quantity;
  final int maxQuantity;
  final String totalPriceLabel;
  final VoidCallback onDecrement;
  final VoidCallback onIncrement;
  final VoidCallback onAdd10;
  final VoidCallback onAdd100;
  final VoidCallback onMax;
  final VoidCallback onReset;
  final VoidCallback onPurchase;

  const _BottomPurchaseBar({
    required this.quantity,
    required this.maxQuantity,
    required this.totalPriceLabel,
    required this.onDecrement,
    required this.onIncrement,
    required this.onAdd10,
    required this.onAdd100,
    required this.onMax,
    required this.onReset,
    required this.onPurchase,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: AppColors.surfaceBorder, width: 1),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── 컴팩트 수량선택 Row ──
          Row(
            children: [
              _QtyStepButton(icon: Icons.remove, onTap: onDecrement),
              Container(
                width: 44,
                alignment: Alignment.center,
                child: Text(
                  '$quantity',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              _QtyStepButton(icon: Icons.add, onTap: onIncrement),
              const SizedBox(width: 10),
              _QtyChip(label: '+10', onTap: onAdd10),
              const SizedBox(width: 6),
              _QtyChip(label: '+100', onTap: onAdd100),
              const SizedBox(width: 6),
              _QtyChip(label: 'MAX', onTap: onMax),
              const Spacer(),
              GestureDetector(
                onTap: onReset,
                child: const Text(
                  '초기화',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // ── 하단 고정 구매 버튼 ──
          SizedBox(
            width: double.infinity,
            height: 56,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: AppColors.goldGradient,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Material(
                type: MaterialType.transparency,
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: onPurchase,
                  child: Center(
                    child: Text(
                      '랜덤박스 구매하기 $totalPriceLabel →',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _QtyStepButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _QtyStepButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.surfaceBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: SizedBox(
          width: 32,
          height: 32,
          child: Icon(icon, size: 16, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _QtyChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _QtyChip({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.surfaceBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.goldSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
