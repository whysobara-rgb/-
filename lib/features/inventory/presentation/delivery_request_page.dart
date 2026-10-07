import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/inventory_repository.dart';
import '../domain/inventory_item.dart';

/// 배송 신청. 배송비(3,000 GP)는 서버가 보유 GP에서 차감한다.
class DeliveryRequestPage extends StatefulWidget {
  final List<InventoryItem> items;

  const DeliveryRequestPage({super.key, required this.items});

  @override
  State<DeliveryRequestPage> createState() => _DeliveryRequestPageState();
}

class _DeliveryRequestPageState extends State<DeliveryRequestPage> {
  /// 백엔드 ShippingService.DELIVERY_FEE와 같은 값.
  static const int _deliveryFee = 3000;
  static const _repository = InventoryRepository();

  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _addressDetail = TextEditingController();
  final _notes = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    for (final c in [_name, _phone, _address, _addressDetail, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _validate() {
    if (_name.text.trim().isEmpty) return '받는 분 이름을 입력해 주세요';
    if (!RegExp(r'^[0-9-]{9,20}$').hasMatch(_phone.text.trim())) {
      return '연락처를 숫자로 입력해 주세요';
    }
    if (_address.text.trim().isEmpty) return '주소를 입력해 주세요';
    return null;
  }

  Future<void> _submit() async {
    final problem = _validate();
    if (problem != null) {
      showToast(context, problem);
      return;
    }
    setState(() => _submitting = true);
    try {
      await _repository.requestShipping(
        recipientName: _name.text.trim(),
        phone: _phone.text.trim(),
        address: [
          _address.text.trim(),
          _addressDetail.text.trim(),
        ].where((s) => s.isNotEmpty).join(' '),
        notes: _notes.text.trim(),
        inventoryItemIds: widget.items.map((i) => i.id).toList(),
      );
      if (!mounted) return;
      await context.read<AuthProvider>().refreshProfile();
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).pop(true);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('배송 신청을 접수했어요')));
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    final balance = context.watch<GpProvider>().balance;
    final enough = balance >= _deliveryFee;

    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('배송 신청')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: Space.x8),
        children: [
          SectionHeader(
            title: '신청 상품 ${items.length}개',
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              Space.x3,
              Space.gutter,
              Space.x2,
            ),
          ),
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const Hairline(inset: Space.gutter),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Space.gutter,
                vertical: 10,
              ),
              child: Row(
                children: [
                  SizedBox(
                    width: 48,
                    height: 48,
                    child: ProductImage(url: items[i].imageUrl),
                  ),
                  const SizedBox(width: Space.x3),
                  RarityTag(items[i].rarity, dense: true),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      items[i].name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong,
                    ),
                  ),
                  Text(
                    formatWon(items[i].estimatedValue),
                    style: AppText.num(AppText.caption),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: Space.x4),
          const SectionBand(),
          const SectionHeader(title: '받는 곳'),
          Padding(
            padding: Space.page,
            child: Column(
              children: [
                _Field(controller: _name, label: '받는 분', hint: '이름'),
                _Field(
                  controller: _phone,
                  label: '연락처',
                  hint: '010-0000-0000',
                  keyboard: TextInputType.phone,
                  formatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9-]')),
                  ],
                ),
                _Field(controller: _address, label: '주소', hint: '도로명 또는 지번 주소'),
                _Field(
                  controller: _addressDetail,
                  label: '상세 주소',
                  hint: '동·호수 (선택)',
                ),
                _Field(
                  controller: _notes,
                  label: '요청사항',
                  hint: '문 앞에 놓아 주세요 (선택)',
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.x2),
          const SectionBand(),
          const SectionHeader(title: '배송비'),
          Padding(
            padding: Space.page,
            child: Column(
              children: [
                InfoRow(label: '배송비', value: formatGp(_deliveryFee)),
                InfoRow(label: '보유', value: formatGp(balance)),
                const Hairline(),
                InfoRow(
                  label: '신청 후 보유',
                  value: enough ? formatGp(balance - _deliveryFee) : 'GP 부족',
                  valueStyle: AppText.num(AppText.bodyStrong).copyWith(
                    color: enough ? AppColors.ink : AppColors.negative,
                  ),
                ),
                const SizedBox(height: Space.x3),
                Text(
                  '배송비는 신청할 때 보유 GP에서 차감돼요. 접수한 뒤에는 주소를 바꿀 수 없으니 한 번 더 확인해 주세요.',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: AppColors.bg,
          border: Border(top: BorderSide(color: AppColors.line)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              Space.x3,
              Space.gutter,
              Space.x3,
            ),
            child: PrimaryButton(
              label: enough ? '${formatGp(_deliveryFee)} 내고 배송 신청' : 'GP가 부족해요',
              loading: _submitting,
              onPressed: enough ? _submit : null,
            ),
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String hint;
  final TextInputType? keyboard;
  final List<TextInputFormatter>? formatters;

  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    this.keyboard,
    this.formatters,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.x3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppText.caption.copyWith(
              color: AppColors.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            keyboardType: keyboard,
            inputFormatters: formatters,
            style: AppText.body,
            decoration: InputDecoration(hintText: hint),
          ),
        ],
      ),
    );
  }
}
