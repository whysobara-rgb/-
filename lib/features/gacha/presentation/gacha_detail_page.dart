import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../home/data/capsule_box_repository.dart';
import '../../home/domain/capsule_box.dart';
import '../../home/domain/gacha_detail.dart';
import 'gacha_animation_page.dart';

/// 가치가차 - 캡슐(랜덤박스) 상세 화면.
///
/// "Vivid Pastel Pop" 크림 화이트 배경 + 코랄 액센트 디자인. 백엔드
/// `GET /gachas/:id`를 통해 실시간 재고와 실제 럭키 라인업 구성을 가져와
/// 표시한다. 홈 화면 카드 탭 시 push되는 화면.
class GachaDetailPage extends StatefulWidget {
  final CapsuleBox box;

  /// "충전" 탭으로 이동하기 위한 콜백. [MainNavigation]에서 전달되며,
  /// 잔액 부족 시 충전 유도 다이얼로그에서 "충전하러 가기"를 누르면
  /// 이 화면을 닫고 충전 탭으로 전환한다.
  final VoidCallback onGoToWallet;

  const GachaDetailPage({
    super.key,
    required this.box,
    required this.onGoToWallet,
  });

  @override
  State<GachaDetailPage> createState() => _GachaDetailPageState();
}

class _GachaDetailPageState extends State<GachaDetailPage> {
  final _repository = const CapsuleBoxRepository();

  GachaDetail? _detail;
  bool _isLoading = true;
  String? _error;

  int _quantity = 1;
  static const int _maxQuantity = 100;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadDetail());
  }

  Future<void> _loadDetail() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final detail = await _repository.getById(widget.box.id);
      if (!mounted) return;
      setState(() {
        _detail = detail;
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
        _error = '박스 정보를 불러오지 못했습니다';
        _isLoading = false;
      });
    }
  }

  void _setQuantity(int value) {
    setState(() {
      _quantity = value.clamp(1, _maxQuantity);
    });
  }

  void _incrementBy(int amount) => _setQuantity(_quantity + amount);

  void _reset() => _setQuantity(1);

  int get _unitPrice => _detail?.price ?? widget.box.priceWon;
  int get _totalPrice => _unitPrice * _quantity;

  /// 구매 버튼 클릭 시 흐름:
  /// 1) 잔액 부족 → "충전하러 가시겠습니까?" 다이얼로그 → 확인 시 이 화면을 닫고
  ///    충전 탭으로 이동.
  /// 2) 잔액 충분 → 구매 확인 다이얼로그 → 확인 시에만 뽑기 애니메이션 화면으로 이동.
  Future<void> _onPurchasePressed() async {
    final gp = context.read<GpProvider>();
    final balance = gp.balance;

    if (balance < _totalPrice) {
      final shortfall = _totalPrice - balance;
      final goToWallet = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: AppColors.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            '포인트가 부족합니다',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          content: Text(
            '현재 보유 GP: ${gp.formattedBalance} GP\n'
            '필요 GP: $_formattedTotalPrice\n'
            '부족한 GP: ${_formatAmount(shortfall)} GP\n\n'
            '포인트를 충전하러 가시겠습니까?',
            style: const TextStyle(color: AppColors.textSecondary),
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
                  color: AppColors.neonPrimary,
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
        backgroundColor: AppColors.surfaceElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          '랜덤박스 구매',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        content: Text(
          '${widget.box.name} $_quantity개를 $_formattedTotalPrice에 구매하시겠습니까?\n'
          '(구매 후 즉시 개봉됩니다)',
          style: const TextStyle(color: AppColors.textSecondary),
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
                color: AppColors.neonPrimary,
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
          builder: (context) =>
              GachaAnimationPage(box: widget.box, count: _quantity),
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

  String get _formattedTotalPrice => '${_formatAmount(_totalPrice)} GP';

  @override
  Widget build(BuildContext context) {
    final box = widget.box;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(
            Icons.arrow_back_ios_new_rounded,
            color: AppColors.textPrimary,
            size: 20,
          ),
        ),
        centerTitle: true,
        title: Text(
          box.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 17,
            fontWeight: FontWeight.w700,
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
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: AppColors.neonPrimary),
              )
            : _error != null
            ? _ErrorState(message: _error!, onRetry: _loadDetail)
            : _buildContent(box, _detail!),
      ),
    );
  }

  Widget _buildContent(CapsuleBox box, GachaDetail detail) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── [1] 상단 비주얼 배너 (실제 이미지 + 그라데이션) ──
                _VisualBanner(box: box, detail: detail),

                // ── [2] 가격 (중앙 정렬) ──
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Center(
                    child: Text(
                      detail.formattedPrice,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),

                if (detail.description.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      detail.description,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                  ),

                const SizedBox(height: 18),

                // ── [3] 실시간 재고 카드 ──
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _StockCard(
                    totalStock: detail.totalStock,
                    soldStock: detail.soldStock,
                    ratio: detail.soldRatio,
                  ),
                ),

                const SizedBox(height: 16),

                // ── [4] 안내 문구 ──
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

                // ── [5] LUCKY LINEUP (실제 라인업) ──
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _LuckyLineupCard(items: detail.lineup),
                ),

                const SizedBox(height: 16),
              ],
            ),
          ),
        ),

        // ── [6] 하단 고정 수량선택 + 구매 버튼 ──
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
          onPurchase: _onPurchasePressed,
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              size: 42,
              color: AppColors.textSecondary,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: onRetry,
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
}

/// [1] 상단 비주얼 배너: 실제 상품 이미지 + 다크 그라데이션 오버레이 + 뱃지.
class _VisualBanner extends StatelessWidget {
  final CapsuleBox box;
  final GachaDetail detail;

  const _VisualBanner({required this.box, required this.detail});

  @override
  Widget build(BuildContext context) {
    final imageUrl = detail.imageUrl ?? box.imageUrl;

    return Container(
      height: 260,
      width: double.infinity,
      color: AppColors.surfaceShell,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (imageUrl != null && imageUrl.isNotEmpty)
            CachedNetworkImage(
              imageUrl: imageUrl,
              fit: BoxFit.cover,
              placeholder: (context, url) => _iconFallback(),
              errorWidget: (context, url, error) => _iconFallback(),
            )
          else
            _iconFallback(),
          // 하단 그라데이션 (텍스트 가독성)
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.transparent,
                    Color(0xCC0A0A0C),
                  ],
                  stops: [0.0, 0.45, 1.0],
                ),
              ),
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
                shadows: [Shadow(color: Colors.black54, blurRadius: 8)],
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

  Widget _iconFallback() {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            box.accentColor.withValues(alpha: 0.6),
            AppColors.scaffoldBg,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(child: Icon(box.icon, size: 96, color: Colors.white)),
    );
  }
}

/// [3] 실시간 재고 카드 (화이트 카드 + 진행률 표시).
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
    final clampedRatio = ratio.clamp(0.0, 1.0);
    final percentLabel = '${(clampedRatio * 100).toStringAsFixed(1)}%';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.surfaceBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
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
                color: AppColors.neonPrimary,
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
                  color: AppColors.neonPrimary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  percentLabel,
                  style: const TextStyle(
                    color: AppColors.neonPrimary,
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
              value: clampedRatio,
              minHeight: 8,
              backgroundColor: AppColors.surfaceElevated2,
              valueColor: const AlwaysStoppedAnimation<Color>(
                AppColors.neonPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// [5] LUCKY LINEUP: 실제 등급별 구성 아이템 (이미지 + 등급뱃지 + 확률).
class _LuckyLineupCard extends StatelessWidget {
  final List<LineupItem> items;

  const _LuckyLineupCard({required this.items});

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
    final totalWeight = items.fold<int>(0, (sum, item) => sum + item.weight);

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.surfaceBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          const Text(
            '★ LUCKY LINEUP ★',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.neonPrimary,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 16),
          if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text(
                '라인업 정보를 불러올 수 없습니다',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
            )
          else
            SizedBox(
              height: 158,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: items.length,
                separatorBuilder: (context, index) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final item = items[index];
                  final color = _rarityColor(item.rarity);
                  return SizedBox(
                    width: 104,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // ── 등급 뱃지 ──
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                              color: color.withValues(alpha: 0.6),
                            ),
                          ),
                          child: Text(
                            item.rarity,
                            style: TextStyle(
                              color: color,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        // ── 실제 상품 이미지 ──
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: SizedBox(
                            width: 72,
                            height: 72,
                            child: item.imageUrl != null
                                ? CachedNetworkImage(
                                    imageUrl: item.imageUrl!,
                                    fit: BoxFit.cover,
                                    placeholder: (context, url) => Container(
                                      color: AppColors.surfaceElevated2,
                                    ),
                                    errorWidget: (context, url, error) =>
                                        Container(
                                          color: AppColors.surfaceElevated2,
                                          child: Icon(
                                            Icons.card_giftcard_rounded,
                                            color: color,
                                            size: 28,
                                          ),
                                        ),
                                  )
                                : Container(
                                    color: AppColors.surfaceElevated2,
                                    child: Icon(
                                      Icons.card_giftcard_rounded,
                                      color: color,
                                      size: 28,
                                    ),
                                  ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          item.name,
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.probabilityLabel(totalWeight),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
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

/// [6] 하단 고정 영역: 컴팩트 수량선택 Row + 구매 버튼.
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
        color: AppColors.surfaceShell,
        border: const Border(
          top: BorderSide(color: AppColors.surfaceBorder, width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, -3),
          ),
        ],
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
                        color: Color(0xFF16161A),
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
              color: AppColors.neonPrimary,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
