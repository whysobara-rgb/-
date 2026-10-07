import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/ui.dart';
import '../../data/wallet_repository.dart';
import '../../domain/topup_limit.dart';

/// 월 충전 한도 설정 시트. 저장되면 새 [TopupLimit]을 돌려준다.
///
/// 낮추면 바로, 올리거나 해제하면 7일 뒤에 적용된다(서버 규칙).
Future<TopupLimit?> showLimitSheet(BuildContext context, TopupLimit current) {
  return showAppSheet<TopupLimit>(
    context: context,
    title: '월 충전 한도',
    builder: (_) => _LimitSheet(current: current),
  );
}

class _LimitSheet extends StatefulWidget {
  final TopupLimit current;
  const _LimitSheet({required this.current});

  @override
  State<_LimitSheet> createState() => _LimitSheetState();
}

class _LimitSheetState extends State<_LimitSheet> {
  static const _repository = WalletRepository();
  static const _presets = [50000, 100000, 300000, 500000, 1000000];

  /// -1: 직접 입력, null: 설정 안 함.
  int? _choice;
  bool _custom = false;
  final _controller = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final cur = widget.current.monthlyLimit;
    if (cur == null) {
      _choice = null;
    } else if (_presets.contains(cur)) {
      _choice = cur;
    } else {
      _custom = true;
      _controller.text = cur.toString();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  int? get _value => _custom ? int.tryParse(_controller.text) : _choice;

  bool get _valid =>
      !_custom || (_value != null && _value! >= 0 && _value! <= 100000000);

  bool get _changed => _value != widget.current.monthlyLimit;

  /// 새 값이 즉시 적용되는지(= 더 엄격해지는지).
  bool get _immediate {
    final cur = widget.current.monthlyLimit;
    final next = _value;
    if (next == null) return false; // 해제는 7일 뒤
    if (cur == null) return true; // 없던 한도를 새로 거는 건 즉시
    return next <= cur;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final result = await _repository.setLimit(_value);
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showToast(context, e.displayMessage);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cur = widget.current;
    final effectiveDate = DateTime.now().add(const Duration(days: 7));
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
          Text(
            cur.hasLimit
                ? '지금 한도 ${formatWon(cur.monthlyLimit!)}'
                : '지금은 한도가 없어요',
            style: AppText.num(AppText.callout),
          ),
          const SizedBox(height: Space.x3),
          _Option(
            label: '설정 안 함',
            selected: !_custom && _choice == null,
            onTap: () => setState(() {
              _custom = false;
              _choice = null;
            }),
          ),
          for (final p in _presets)
            _Option(
              label: formatWon(p),
              selected: !_custom && _choice == p,
              onTap: () => setState(() {
                _custom = false;
                _choice = p;
              }),
            ),
          _Option(
            label: '직접 입력',
            selected: _custom,
            onTap: () => setState(() => _custom = true),
          ),
          if (_custom)
            Padding(
              padding: const EdgeInsets.only(top: Space.x2),
              child: TextField(
                controller: _controller,
                autofocus: true,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: AppText.num(AppText.body),
                decoration: const InputDecoration(
                  hintText: '금액 (원)',
                  suffixText: '원',
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
          const SizedBox(height: Space.x4),
          Container(
            padding: const EdgeInsets.all(Space.x4),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: Radii.card,
            ),
            child: Text(
              !_changed
                  ? '한도를 낮추면 바로 적용돼요. 올리거나 해제하면 7일 뒤에 적용돼요.'
                  : _immediate
                  ? '저장하면 바로 적용돼요.'
                  : '한도를 올리거나 해제하면 7일 뒤(${formatMonthDay(effectiveDate)})에 적용돼요. 그 전까지는 지금 한도가 유지돼요.',
              style: AppText.caption.copyWith(color: AppColors.text),
            ),
          ),
          const SizedBox(height: Space.x5),
          PrimaryButton(
            label: '저장',
            loading: _saving,
            onPressed: _changed && _valid ? _save : null,
          ),
        ],
      ),
    );
  }
}

class _Option extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Option({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: AppText.num(AppText.body).copyWith(
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 22,
              color: selected ? AppColors.text : AppColors.textDisabled,
            ),
          ],
        ),
      ),
    );
  }
}
