import '../../orders/order_flow_page.dart';
import '../../../shared/providers/auth_provider.dart';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/gachi_components.dart';
import 'product_detail_view.dart';
export 'product_detail_view.dart' show ProductDetailView;
import '../../orders/order_models.dart';
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
  /// 잔액 부족 시 충전 유도 다이얼로그에서 "GP 내역 보기"를 누르면
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
  Odds? _odds;
  bool _isLoading = true;
  String? _error;

  int _quantity = 1;
  bool _purchaseInProgress = false;
  int get _maxQuantity {
    final remaining = (_detail?.totalStock ?? 0) - (_detail?.soldStock ?? 0);
    return remaining > 0 ? remaining.clamp(1, 100) : 1;
  }

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
      Odds? odds;
      try {
        odds = Odds(await const ApiClient().get('/gachas/${widget.box.id}/odds'));
        if (odds.gachaId != widget.box.id) odds = null;
      } catch (_) { /* Keep the catalog readable if odds are not published. */ }
      if (!mounted) return;
      setState(() {
        _odds = odds;
        _detail = detail;
        _quantity = _quantity.clamp(1, _maxQuantity);
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

  int get _unitPrice => _detail?.price ?? widget.box.priceWon;
  int get _totalPrice => _unitPrice * _quantity;

  /// 구매 버튼 클릭 시 흐름:
  /// 1) 잔액 부족 → "충전하러 가시겠습니까?" 다이얼로그 → 확인 시 이 화면을 닫고
  ///    충전 탭으로 이동.
  /// 2) 잔액 충분 → 구매 확인 다이얼로그 → 확인 시에만 뽑기 애니메이션 화면으로 이동.
  Future<void> _onPurchasePressed() async {
    if (_purchaseInProgress || _isLoading || _detail == null ||
        _detail!.soldStock >= _detail!.totalStock) {
      return;
    }
    if (AppConfig.orderPreviewEnabled) {
      final user = context.read<AuthProvider>().currentUser;
      if (user == null) return;
      _purchaseInProgress = true;
      try {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => OrderFlowPage(
              userId: user.id,
              gachaId: widget.box.id,
              title: widget.box.name,
              initialQuantity: _quantity.clamp(1, 100),
            ),
          ),
        );
        if (mounted) await _loadDetail();
      } finally {
        _purchaseInProgress = false;
      }
      return;
    }
    if (!AppConfig.legacyTransactionsEnabled) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('현재 캡슐 구매 서비스를 준비하고 있습니다')));
      return;
    }
    if (_detail == null || _detail!.totalStock <= _detail!.soldStock) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('구매 가능한 캡슐이 없습니다')));
      return;
    }
    _purchaseInProgress = true;
    try {
      await _confirmPurchase();
    } finally {
      _purchaseInProgress = false;
    }
  }

  Future<void> _confirmPurchase() async {
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
            'GP는 별도 충전할 수 없습니다. GP 내역을 확인하시겠습니까?',
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
                'GP 내역 보기',
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
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) =>
              GachaAnimationPage(box: widget.box, count: _quantity),
        ),
      );
      if (mounted) await _loadDetail();
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
  Widget build(BuildContext context) => GachiScaffold(
    title: '박스 상세',
    body: _isLoading ? const GachiLoadingState()
      : _error != null ? SingleChildScrollView(
          padding: const EdgeInsets.all(GachiSpace.page),
          child: GachiErrorState(message: _error!, onRetry: _loadDetail))
      : ProductDetailView(
          box: widget.box, detail: _detail!, odds: _odds,
          quantity: _quantity, maxQuantity: _maxQuantity,
          totalPriceLabel: _formattedTotalPrice,
          onDecrement: () => _setQuantity(_quantity - 1),
          onIncrement: () => _setQuantity(_quantity + 1),
          onPurchase: _onPurchasePressed,
        ),
  );
}
