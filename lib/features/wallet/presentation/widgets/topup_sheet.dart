import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/ui.dart';
import '../../domain/topup_limit.dart';

/// 충전 금액 선택 시트. 선택한 금액을 돌려준다.
Future<int?> showTopupSheet(
  BuildContext context, {
  required int balance,
  TopupLimit? limit,
}) {
  return showAppSheet<int>(
    context: context,
    title: 'GP 충전',
    builder: (_) => _TopupSheet(balance: balance, limit: limit),
  );
}

class _TopupSheet extends StatefulWidget {
  final int balance;
  final TopupLimit? limit;
  const _TopupSheet({required this.balance, required this.limit});

  @override
  State<_TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<_TopupSheet> {
  static const _presets = [10000, 30000, 50000, 100000];
  static const _min = 100;
  static const _max = 1000000;

  int? _selected = 10000;
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  int? get _amount =>
      _controller.text.isNotEmpty ? int.tryParse(_controller.text) : _selected;

  int? get _remaining => widget.limit?.remainingThisMonth;

  String? get _problem {
    final a = _amount;
    if (a == null) return null;
    if (a < _min || a > _max) {
      return '${formatNumber(_min)}원부터 ${formatNumber(_max)}원까지 충전할 수 있어요';
    }
    final r = _remaining;
    if (r != null && a > r) return '이번 달 남은 한도(${formatWon(r)})를 넘어요';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final amount = _amount;
    final problem = _problem;
    final canSubmit = amount != null && problem == null;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x4,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('1 GP = 1원', style: AppText.caption),
          const SizedBox(height: Space.x3),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: Space.x2,
            mainAxisSpacing: Space.x2,
            childAspectRatio: 3.2,
            children: [
              for (final p in _presets)
                _AmountTile(
                  label: formatWon(p),
                  selected: _controller.text.isEmpty && _selected == p,
                  disabled: _remaining != null && p > _remaining!,
                  onTap: () => setState(() {
                    _controller.clear();
                    _selected = p;
                  }),
                ),
            ],
          ),
          const SizedBox(height: Space.x2),
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: AppText.num(AppText.body),
            decoration: const InputDecoration(
              hintText: '직접 입력',
              suffixText: '원',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: Space.x4),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Space.x4,
              vertical: Space.x2,
            ),
            decoration: const BoxDecoration(
              color: AppColors.bgSubtle,
              borderRadius: Radii.card,
            ),
            child: Column(
              children: [
                InfoRow(
                  label: '결제 금액',
                  value: amount == null ? '-' : formatWon(amount),
                ),
                InfoRow(
                  label: '충전 후 보유',
                  value: amount == null
                      ? '-'
                      : formatGp(widget.balance + amount),
                ),
                if (_remaining != null)
                  InfoRow(label: '이번 달 남은 한도', value: formatWon(_remaining!)),
              ],
            ),
          ),
          if (problem != null) ...[
            const SizedBox(height: Space.x2),
            Text(
              problem,
              style: AppText.caption.copyWith(color: AppColors.negative),
            ),
          ],
          const SizedBox(height: Space.x2),
          Text(
            '데모 환경이라 실제 결제 없이 바로 충전돼요.',
            style: AppText.caption.copyWith(color: AppColors.inkTertiary),
          ),
          const SizedBox(height: Space.x4),
          PrimaryButton(
            label: amount == null ? '금액을 선택해 주세요' : '${formatWon(amount)} 결제하기',
            onPressed: canSubmit
                ? () => Navigator.of(context).pop(amount)
                : null,
          ),
        ],
      ),
    );
  }
}

class _AmountTile extends StatelessWidget {
  final String label;
  final bool selected;
  final bool disabled;
  final VoidCallback onTap;

  const _AmountTile({
    required this.label,
    required this.selected,
    required this.disabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: disabled ? null : onTap,
      borderRadius: Radii.button,
      child: AnimatedContainer(
        duration: Motion.fast,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: Radii.button,
          border: Border.all(
            color: selected ? AppColors.ink : AppColors.line,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label,
          style: AppText.num(
            AppText.bodyStrong,
          ).copyWith(color: disabled ? AppColors.inkDisabled : AppColors.ink),
        ),
      ),
    );
  }
}
