import 'package:flutter/material.dart';
import '../../shared/widgets/gachi_components.dart';
import 'order_models.dart';

/// Presentation only. The receipt and balance come from the existing flow.
class PurchaseCompletionView extends StatelessWidget {
  final Receipt receipt;
  final VoidCallback? onPrepareOpening, onLater;
  const PurchaseCompletionView({
    super.key,
    required this.receipt,
    required this.onPrepareOpening,
    required this.onLater,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text('구매가 완료됐어요', style: GachiType.pageTitle),
      const SizedBox(height: GachiSpace.lg),
      Text(receipt.title, style: GachiType.section),
      const SizedBox(height: GachiSpace.sm),
      Text(
        '${receipt.quantity}개 · ${receipt.total.toString().replaceAllMapped(RegExp(r"(\d)(?=(\d{3})+(?!\d))"), (m) => '${m[1]},')} GP 사용',
      ),
      const SizedBox(height: GachiSpace.lg),
      const Text(
        '구매한 박스는 미개봉으로 보관됩니다. 다음 화면에서 선택을 확인하고 개봉해주세요. 추가 GP 차감은 없어요.',
      ),
      const SizedBox(height: GachiSpace.lg),
      GachiPrimaryButton(
        label: '구매한 ${receipt.unopenedCount}개 개봉 준비',
        onPressed: onPrepareOpening,
      ),
      const SizedBox(height: GachiSpace.sm),
      GachiSecondaryButton(label: '나중에 개봉', onPressed: onLater),
    ],
  );
}
