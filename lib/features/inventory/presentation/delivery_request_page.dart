import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/rank_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../domain/inventory_item.dart';

/// 가치가차 - 배송 신청 화면.
///
/// 보관함(박스) 탭에서 상품을 선택한 뒤 "배송요청" 버튼을 눌렀을 때 이동하는 화면.
/// 배송지 정보를 입력하고 GP로 배송비를 결제하는 흐름을 담당한다.
/// 화이트+골드 테마를 그대로 적용한다.
class DeliveryRequestPage extends StatefulWidget {
  final List<InventoryItem> items;

  const DeliveryRequestPage({super.key, required this.items});

  @override
  State<DeliveryRequestPage> createState() => _DeliveryRequestPageState();
}

class _DeliveryRequestPageState extends State<DeliveryRequestPage> {
  // 백엔드 ShippingService.DELIVERY_FEE(3000 GP)와 동일한 고정 배송비.
  static const int _deliveryFee = 3000;

  final ApiClient _apiClient = const ApiClient();

  final _recipientController = TextEditingController();
  final _phoneController = TextEditingController();
  final _postalCodeController = TextEditingController();
  final _addressController = TextEditingController();
  final _detailAddressController = TextEditingController();
  final _notesController = TextEditingController();

  bool _isSubmitting = false;

  @override
  void dispose() {
    _recipientController.dispose();
    _phoneController.dispose();
    _postalCodeController.dispose();
    _addressController.dispose();
    _detailAddressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String _formatWon(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return buffer.toString();
  }

  // ── 주소 검색 (더미) ─────────────────────────────────────────────
  void _openAddressSearch() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('주소 검색 기능은 추후 연동 예정')));
  }

  void _showWarning(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _submit() async {
    if (_isSubmitting) return;
    if (_recipientController.text.trim().isEmpty) {
      _showWarning('받는 사람을 입력해주세요');
      return;
    }
    if (_phoneController.text.trim().isEmpty) {
      _showWarning('연락처를 입력해주세요');
      return;
    }
    if (_addressController.text.trim().isEmpty) {
      _showWarning('주소를 입력해주세요');
      return;
    }

    // 우편번호/상세주소는 백엔드 DTO에 별도 필드가 없으므로 기본 주소에 합쳐 전송한다.
    final fullAddress = [
      _addressController.text.trim(),
      _detailAddressController.text.trim(),
    ].where((s) => s.isNotEmpty).join(' ');

    setState(() => _isSubmitting = true);
    try {
      await _apiClient.post(
        '/shipping-requests',
        body: {
          'recipientName': _recipientController.text.trim(),
          'phone': _phoneController.text.trim(),
          'address': fullAddress,
          if (_notesController.text.trim().isNotEmpty)
            'notes': _notesController.text.trim(),
          'inventoryItemIds': widget.items
              .map((item) => item.numericId)
              .toList(),
        },
      );

      // 배송비(GP) 차감이 서버에서 이루어졌으므로 최신 잔액을 다시 조회한다.
      if (mounted) {
        await context.read<AuthProvider>().refreshProfile();
      }

      if (!mounted) return;
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Text(
              '배송 신청 완료',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            content: const Text("배송 신청이 완료되었습니다!\n상품이 '배송요청' 상태로 변경됩니다."),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                  Navigator.of(context).pop(true);
                },
                child: const Text(
                  '확인',
                  style: TextStyle(
                    color: AppColors.goldSecondary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          );
        },
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      _showWarning(e.message);
    } catch (_) {
      if (!mounted) return;
      _showWarning('배송 신청 중 오류가 발생했습니다');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    final previewItems = items.take(3).toList();
    final extraCount = items.length - previewItems.length;
    final totalValue = items.fold<int>(0, (sum, item) => sum + item.price);
    final gpBalance = context.watch<GpProvider>().formattedBalance;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        iconTheme: const IconThemeData(color: AppColors.textPrimary),
        title: const Text(
          '배송 신청',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildProductSummaryCard(
                      previewItems,
                      extraCount,
                      items.length,
                      totalValue,
                    ),
                    const SizedBox(height: 16),
                    _buildAddressCard(),
                    const SizedBox(height: 16),
                    _buildNotesCard(),
                    const SizedBox(height: 16),
                    _buildFeeCard(gpBalance),
                  ],
                ),
              ),
            ),
            _buildBottomButton(),
          ],
        ),
      ),
    );
  }

  Widget _sectionCard({required Widget title, required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
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
        children: [title, const SizedBox(height: 14), child],
      ),
    );
  }

  Widget _plainTitle(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 16,
        fontWeight: FontWeight.w700,
      ),
    );
  }

  // ── [1] 신청 상품 요약 카드 ──────────────────────────────────────
  Widget _buildProductSummaryCard(
    List<InventoryItem> previewItems,
    int extraCount,
    int totalCount,
    int totalValue,
  ) {
    return _sectionCard(
      title: _plainTitle('신청 상품 $totalCount개'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final item in previewItems)
                Expanded(child: _PreviewChip(item: item)),
              if (extraCount > 0)
                Padding(
                  padding: const EdgeInsets.only(left: 6, top: 4),
                  child: Text(
                    '+$extraCount개 더',
                    style: const TextStyle(
                      color: AppColors.goldSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Container(height: 1, color: AppColors.surfaceBorder),
          const SizedBox(height: 12),
          Text(
            '총 예상 가치: ${_formatWon(totalValue)}원',
            style: const TextStyle(
              color: AppColors.goldPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  // ── [2] 배송지 입력 카드 ──────────────────────────────────────────
  Widget _buildAddressCard() {
    return _sectionCard(
      title: _plainTitle('배송지 정보'),
      child: Column(
        children: [
          _buildTextField(
            controller: _recipientController,
            hintText: '받는 사람',
            icon: Icons.person_outline_rounded,
          ),
          const SizedBox(height: 10),
          _buildTextField(
            controller: _phoneController,
            hintText: '연락처',
            icon: Icons.phone_outlined,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: _buildTextField(
                  controller: _postalCodeController,
                  hintText: '우편번호',
                  icon: Icons.markunread_mailbox_outlined,
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 46,
                child: OutlinedButton(
                  onPressed: _openAddressSearch,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.goldSecondary,
                    side: const BorderSide(color: AppColors.goldSecondary),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  child: const Text(
                    '주소 검색',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _buildTextField(
            controller: _addressController,
            hintText: '기본 주소',
            icon: Icons.location_on_outlined,
          ),
          const SizedBox(height: 10),
          _buildTextField(
            controller: _detailAddressController,
            hintText: '상세 주소',
            icon: Icons.home_outlined,
          ),
        ],
      ),
    );
  }

  // ── [3] 배송 요청사항 카드 ────────────────────────────────────────
  Widget _buildNotesCard() {
    return _sectionCard(
      title: Row(
        children: [
          _plainTitle('배송 요청사항'),
          const SizedBox(width: 6),
          const Text(
            '(선택)',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
        ],
      ),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: TextField(
          controller: _notesController,
          maxLines: 4,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
          decoration: const InputDecoration(
            hintText: '배송 시 요청사항을 입력해주세요',
            hintStyle: TextStyle(color: AppColors.textSecondary, fontSize: 13),
            border: InputBorder.none,
            contentPadding: EdgeInsets.all(14),
          ),
        ),
      ),
    );
  }

  // ── [4] 배송비 안내 카드 ──────────────────────────────────────────
  Widget _buildFeeCard(String gpBalance) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
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
              const Text(
                '배송비',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              const Text(
                '$_deliveryFee GP',
                style: TextStyle(
                  color: AppColors.goldPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            '배송비는 보유 GP에서 자동 차감됩니다.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 12),
          Container(height: 1, color: AppColors.surfaceBorder),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text(
                '현재 보유 GP',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
              ),
              const Spacer(),
              Text(
                '$gpBalance GP',
                style: const TextStyle(
                  color: AppColors.goldPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            "※ 배송 신청 후 '상품 준비중' 단계까지만 취소 가능합니다.",
            style: TextStyle(color: AppColors.badgeSpecial, fontSize: 11),
          ),
          const SizedBox(height: 4),
          const Text(
            '※ 배송 신청 접수 후에는 배송지 주소를 변경할 수 없습니다.',
            style: TextStyle(color: AppColors.badgeSpecial, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hintText,
    required IconData icon,
    TextInputType? keyboardType,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 14,
          ),
          prefixIcon: Icon(icon, color: AppColors.textSecondary, size: 20),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
        ),
      ),
    );
  }

  // ── [5] 하단 고정 버튼 ────────────────────────────────────────────
  Widget _buildBottomButton() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
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
      child: Container(
        width: double.infinity,
        height: 56,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: AppColors.goldGradient,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            onTap: _isSubmitting ? null : _submit,
            borderRadius: BorderRadius.circular(14),
            child: Center(
              child: _isSubmitting
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: Color(0xFF16161A),
                      ),
                    )
                  : const Text(
                      '배송 신청하기',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF16161A),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 상품 요약 카드에 표시되는 개별 상품 미리보기 칩(가로 배치, 최대 3개).
class _PreviewChip extends StatelessWidget {
  final InventoryItem item;

  const _PreviewChip({required this.item});

  @override
  Widget build(BuildContext context) {
    final color = RankColors.of(item.grade);
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.surfaceBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              item.grade,
              style: const TextStyle(
                color: Color(0xFF16161A),
                fontSize: 9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            item.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
