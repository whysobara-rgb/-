import '../../orders/order_flow_page.dart';
import '../../../shared/providers/auth_provider.dart';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../home/presentation/widgets/capsule_box_card.dart';
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
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('박스 상세'),
      leading: IconButton(tooltip: '뒤로', icon: const Icon(Icons.arrow_back_rounded),
        onPressed: () => Navigator.of(context).pop()),
    ),
    body: _isLoading ? const Center(child: CircularProgressIndicator())
      : _error != null ? Center(child: Padding(padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off_rounded, size: 36, color: AppColors.textSecondary),
            const SizedBox(height: 16),
            Text(_error!, textAlign: TextAlign.center),
            TextButton(onPressed: _loadDetail, child: const Text('다시 불러오기')),
          ])))
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

/// The same presentation is rendered in visual review and the live detail route.
class ProductDetailView extends StatelessWidget {
  final CapsuleBox box;
  final GachaDetail detail;
  final Odds? odds;
  final int quantity, maxQuantity;
  final String totalPriceLabel;
  final VoidCallback onDecrement, onIncrement, onPurchase;
  const ProductDetailView({super.key, required this.box, required this.detail,
    required this.odds, required this.quantity, required this.maxQuantity,
    required this.totalPriceLabel, required this.onDecrement,
    required this.onIncrement, required this.onPurchase});

  @override
  Widget build(BuildContext context) {
    final remaining = (detail.totalStock - detail.soldStock).clamp(0, detail.totalStock < 0 ? 0 : detail.totalStock);
    final soldOut = remaining == 0;
    final artwork = CapsuleBox(id: box.id, name: detail.title, priceWon: detail.price,
      icon: detail.icon, accentColor: detail.accentColor, imageUrl: detail.imageUrl ?? box.imageUrl,
      badgeLabel: detail.badgeLabel, iconName: box.iconName);
    return Column(children: [
      Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 28), children: [
        ClipRRect(borderRadius: BorderRadius.circular(26),
          child: AspectRatio(aspectRatio: 1.35, child: CatalogArtwork(box: artwork))),
        const SizedBox(height: 24),
        Wrap(spacing: 8, runSpacing: 8, children: [
          const _DetailTag(label: 'GP BOX'),
          if (detail.badgeLabel?.isNotEmpty == true) _DetailTag(label: detail.badgeLabel!),
          if (soldOut) const _DetailTag(label: '품절'),
        ]),
        const SizedBox(height: 12),
        Text(detail.title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, height: 1.25, letterSpacing: -.8)),
        const SizedBox(height: 14),
        Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
          Text(detail.formattedPrice, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: -1)),
          const Text('/ 1회', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ]),
        if (detail.description.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(detail.description, style: const TextStyle(fontSize: 14, height: 1.6, color: AppColors.textSecondary)),
        ],
        const SizedBox(height: 24),
        Container(padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(color: Colors.white, border: Border.all(color: AppColors.surfaceBorder),
            borderRadius: BorderRadius.circular(18)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 8, children: [
              const Text('남은 수량', style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
              Text('$remaining개', style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(height: 12),
            ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(
              value: detail.totalStock > 0 ? remaining / detail.totalStock : 0,
              minHeight: 6, color: AppColors.primary, backgroundColor: AppColors.surfaceElevated2)),
            const SizedBox(height: 8),
            Text('전체 ${detail.totalStock}개 중 ${detail.soldStock}개 판매',
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ]),
        ),
        const SizedBox(height: 30),
        const Text('어떤 상품을 만날까요?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -.5)),
        const SizedBox(height: 8),
        const Text('구성 상품과 공개 확률을 확인하세요.',
          style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
        const SizedBox(height: 18),
        if (odds == null)
          Container(padding: const EdgeInsets.all(18), decoration: BoxDecoration(
            color: AppColors.surfaceElevated2, borderRadius: BorderRadius.circular(16)),
            child: const Text('공개 확률을 불러오지 못했어요. 구매 전 확인 단계에서 다시 확인해주세요.',
              style: TextStyle(height: 1.5, color: AppColors.textSecondary)))
        else ...odds!.prizes.map((prize) => Padding(padding: const EdgeInsets.only(bottom: 10),
          child: Container(padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.surfaceBorder)),
            child: Row(children: [
              Container(width: 44, height: 44, alignment: Alignment.center,
                decoration: BoxDecoration(color: prize.premium ? const Color(0xFFFFEAE3) : AppColors.surfaceElevated2,
                  borderRadius: BorderRadius.circular(12)),
                child: Icon(prize.premium ? Icons.auto_awesome_rounded : Icons.style_outlined,
                  color: prize.premium ? AppColors.primary : AppColors.textSecondary)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(prize.name, style: const TextStyle(fontWeight: FontWeight.w700, height: 1.4)),
                const SizedBox(height: 4),
                Text('${prize.displayGrade} · ${prize.premium ? '프리미엄' : '일반'}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                const SizedBox(height: 6),
                Text(prize.probability, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              ])),
            ]),
          ),
        )),
        const SizedBox(height: 18),
        const Text('구매 후 미개봉 캡슐이 보관됩니다. 개봉 시 상품이 결정되며, 개봉에는 GP가 추가로 차감되지 않습니다.',
          style: TextStyle(fontSize: 12, height: 1.6, color: AppColors.textSecondary)),
      ])),
      Container(decoration: const BoxDecoration(color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.surfaceBorder))),
        child: SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(children: [
              const Expanded(child: Text('구매 수량', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
              IconButton(tooltip: '수량 줄이기', onPressed: quantity > 1 && !soldOut ? onDecrement : null,
                icon: const Icon(Icons.remove_rounded)),
              Text('$quantity', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              IconButton(tooltip: '수량 늘리기', onPressed: quantity < maxQuantity && !soldOut ? onIncrement : null,
                icon: const Icon(Icons.add_rounded)),
            ]),
            const SizedBox(height: 8),
            SizedBox(width: double.infinity, child: FilledButton(
              onPressed: soldOut ? null : onPurchase,
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(soldOut ? '품절된 박스예요' : '$totalPriceLabel · 구매 전 확인',
                  textAlign: TextAlign.center)),
            )),
          ]),
        )),
      ),
    ]);
  }
}
class _DetailTag extends StatelessWidget {
  final String label;
  const _DetailTag({required this.label});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(color: AppColors.surfaceElevated2, borderRadius: BorderRadius.circular(6)),
    child: Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: .4)),
  );
}
