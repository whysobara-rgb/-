import 'package:flutter/material.dart';
import '../../shared/widgets/gachi_components.dart';
import '../../shared/widgets/gachi_opening.dart';
import 'order_models.dart';
import 'prize_reveal.dart';

/// Shared presentation for a direct single open and GET-only result recovery.
/// Request/recovery/acknowledgement remain owned by OrderFlowPage.
class SingleOpeningView extends StatelessWidget {
  final Opening? opening;
  final VoidCallback? onCollection, onUnopened, onClose;
  const SingleOpeningView({
    super.key,
    required this.opening,
    required this.onCollection,
    required this.onUnopened,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      GachiOpeningHeading(
        title: opening == null ? '박스를 열고 있어요' : '1개 개봉 완료',
        description: '추가 결제 0 GP · 확인된 결과만 공개합니다.',
      ),
      GachiOpeningExperience(
        waiting: opening == null,
        result: opening == null
            ? const SizedBox.shrink()
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PrizeReveal(
                    animate: false,
                    key: ValueKey(opening!.capsuleId),
                    prize: opening!.prize,
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: GachiSpace.lg),
                    child: Text(
                      '내 보관함에 저장했어요. 이 화면을 다시 열어도 같은 결과를 확인할 수 있습니다.',
                    ),
                  ),
                  GachiPrimaryButton(
                    label: '보관함 보기',
                    gold: true,
                    onPressed: onCollection,
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: OutlinedButton(
                      onPressed: onUnopened,
                      child: const Text('미개봉 보관함으로'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: OutlinedButton(
                      onPressed: onClose,
                      child: const Text('확인하고 돌아가기'),
                    ),
                  ),
                ],
              ),
      ),
    ],
  );
}
