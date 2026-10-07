import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/gp_badge.dart';
import '../../../../shared/widgets/ui.dart';
import '../../domain/payment_models.dart';
import '../../domain/topup_limit.dart';

/// 이 빌드에서 결제창을 열 수 있는지.
enum CheckoutMode {
  /// 토스 결제위젯(앱).
  toss,

  /// 디버그 테스트 결제.
  sandbox,

  /// 결제창 없음(웹) → "결제는 앱에서 가능해요".
  unavailable,
}

/// 충전 패키지 선택 시트. 고른 패키지를 돌려준다.
Future<TopupPackage?> showTopupSheet(
  BuildContext context, {
  required PaymentConfig config,
  required int balance,
  required CheckoutMode mode,
  TopupLimit? limit,
}) {
  return showAppSheet<TopupPackage>(
    context: context,
    title: 'GP 충전',
    builder: (_) =>
        TopupSheet(config: config, balance: balance, limit: limit, mode: mode),
  );
}

class TopupSheet extends StatefulWidget {
  final PaymentConfig config;
  final int balance;
  final TopupLimit? limit;
  final CheckoutMode mode;

  const TopupSheet({
    super.key,
    required this.config,
    required this.balance,
    required this.mode,
    this.limit,
  });

  @override
  State<TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<TopupSheet> {
  TopupPackage? _selected;

  int? get _remaining => widget.limit?.remainingThisMonth;

  bool _overLimit(TopupPackage p) =>
      _remaining != null && p.price > _remaining!;

  @override
  void initState() {
    super.initState();
    // 한도 안에서 가장 많이 팔릴 만한 1만원권을 먼저 고른다.
    final usable = widget.config.packages.where((p) => !_overLimit(p));
    _selected =
        usable.where((p) => p.id == 'gp10000').firstOrNull ??
        usable.firstOrNull;
  }

  @override
  Widget build(BuildContext context) {
    final config = widget.config;
    final selected = _selected;
    final bonus = config.firstTopupBonus;
    final canPay = widget.mode != CheckoutMode.unavailable && selected != null;

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
            '1 GP = 1원 · 보유 ${formatGp(widget.balance)}',
            style: AppText.num(AppText.caption),
          ),
          if (bonus != null && bonus.eligible) ...[
            const SizedBox(height: Space.x3),
            _FirstTopupBanner(bonus: bonus),
          ],
          const SizedBox(height: Space.x3),
          GridView(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: Space.x2,
              mainAxisSpacing: Space.x2,
              mainAxisExtent: 128,
            ),
            children: [
              for (final p in config.packages)
                _PackageTile(
                  package: p,
                  selected: selected?.id == p.id,
                  overLimit: _overLimit(p),
                  onTap: () => setState(() => _selected = p),
                ),
            ],
          ),
          const SizedBox(height: Space.x3),
          _LimitNote(limit: widget.limit),
          const SizedBox(height: Space.x3),
          SheetPanel(
            child: Column(
              children: [
                InfoRow(
                  label: '결제 금액',
                  value: selected == null ? '-' : formatWon(selected.price),
                ),
                InfoRow(
                  label: '받는 GP',
                  value: selected == null ? '-' : formatGp(selected.totalGp),
                  valueStyle: AppText.num(
                    AppText.bodyStrong,
                  ).copyWith(color: AppColors.brand),
                ),
                InfoRow(
                  label: '충전 후 보유',
                  value: selected == null
                      ? '-'
                      : formatGp(widget.balance + selected.totalGp),
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.x4),
          if (widget.mode == CheckoutMode.unavailable) ...[
            const _AppOnlyNote(),
            const SizedBox(height: Space.x3),
          ],
          if (widget.mode == CheckoutMode.sandbox) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.science_outlined,
                  size: 14,
                  color: AppColors.danger,
                ),
                const SizedBox(width: 4),
                Text(
                  '테스트 결제(샌드박스) · 실제로 결제되지 않아요',
                  style: AppText.caption.copyWith(color: AppColors.danger),
                ),
              ],
            ),
            const SizedBox(height: Space.x2),
          ],
          PrimaryButton(
            label: switch (widget.mode) {
              CheckoutMode.unavailable => '결제는 앱에서 가능해요',
              _ when selected == null => '패키지를 골라 주세요',
              CheckoutMode.sandbox => '${formatWon(selected.price)} 테스트 결제',
              CheckoutMode.toss => '${formatWon(selected.price)} 결제하기',
            },
            onPressed: canPay
                ? () => Navigator.of(context).pop(selected)
                : null,
          ),
          const SizedBox(height: Space.x2),
          Text(
            '결제는 토스페이먼츠로 처리돼요. 충전한 GP는 앱 안에서만 써요.',
            textAlign: TextAlign.center,
            style: AppText.caption.copyWith(color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}

class _FirstTopupBanner extends StatelessWidget {
  final FirstTopupBonus bonus;
  const _FirstTopupBanner({required this.bonus});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(Space.x3, 10, Space.x3, 10),
      decoration: BoxDecoration(
        borderRadius: Radii.button,
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.4)),
        gradient: LinearGradient(
          colors: [
            AppColors.brand.withValues(alpha: 0.16),
            AppColors.brand.withValues(alpha: 0.04),
          ],
        ),
      ),
      child: Row(
        children: [
          const GpCoin(size: 26),
          const SizedBox(width: Space.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '첫 충전 보너스 +${bonus.percent}%',
                  style: AppText.bodyStrong.copyWith(color: AppColors.brand),
                ),
                Text(
                  '처음 충전하면 산 GP의 ${bonus.percent}%를 더 드려요 '
                  '(최대 ${formatGp(bonus.maxGp)})',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PackageTile extends StatelessWidget {
  final TopupPackage package;
  final bool selected;
  final bool overLimit;
  final VoidCallback onTap;

  const _PackageTile({
    required this.package,
    required this.selected,
    required this.overLimit,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final p = package;
    return Semantics(
      button: true,
      selected: selected,
      enabled: !overLimit,
      label: '${formatGp(p.gp)} ${formatWon(p.price)}',
      excludeSemantics: true,
      child: InkWell(
        onTap: overLimit ? null : onTap,
        borderRadius: Radii.button,
        child: Opacity(
          opacity: overLimit ? 0.4 : 1,
          child: AnimatedContainer(
            duration: Motion.fast,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            decoration: BoxDecoration(
              color: selected ? AppColors.brandTint : AppColors.surface,
              borderRadius: Radii.button,
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.hairline,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 18,
                  child: overLimit
                      ? const _Badge('한도 초과', muted: true)
                      : p.firstTopupBonusGp > 0
                      ? _Badge('첫 충전 +${p.firstBonusPercent}%')
                      : null,
                ),
                const Spacer(),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    formatGp(p.gp),
                    maxLines: 1,
                    style: AppText.num(
                      AppText.headline,
                    ).copyWith(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                ),
                if (p.bonusGp > 0)
                  _BonusLine(
                    '+${formatGp(p.bonusGp)} 대량 보너스',
                    color: AppColors.text,
                  ),
                if (p.firstTopupBonusGp > 0)
                  _BonusLine(
                    '+${formatGp(p.firstTopupBonusGp)} 첫 충전',
                    color: AppColors.brand,
                  ),
                const Spacer(),
                Text(
                  formatWon(p.price),
                  maxLines: 1,
                  style: AppText.num(
                    AppText.callout,
                  ).copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BonusLine extends StatelessWidget {
  final String text;
  final Color color;
  const _BonusLine(this.text, {required this.color});

  @override
  Widget build(BuildContext context) => Text(
    text,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: AppText.num(AppText.micro).copyWith(color: color),
  );
}

class _Badge extends StatelessWidget {
  final String text;
  final bool muted;
  const _Badge(this.text, {this.muted = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? AppColors.high : AppColors.brand,
        borderRadius: Radii.chip,
      ),
      child: Text(
        text,
        style: AppText.micro.copyWith(
          color: muted ? AppColors.textSecondary : AppColors.onBrand,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
    );
  }
}

/// 월 충전 한도 안내 한 줄.
class _LimitNote extends StatelessWidget {
  final TopupLimit? limit;
  const _LimitNote({required this.limit});

  @override
  Widget build(BuildContext context) {
    final l = limit;
    final String text;
    if (l == null) {
      text = '월 충전 한도 정보를 불러오지 못했어요. 한도를 넘으면 결제 전에 알려 드려요.';
    } else if (l.hasLimit) {
      text =
          '이번 달 남은 충전 한도 ${formatWon(l.remainingThisMonth ?? 0)} '
          '(한도 ${formatWon(l.monthlyLimit!)})';
    } else {
      text = '월 충전 한도 없음 · 이번 달 ${formatWon(l.usedThisMonth)} 충전';
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(
            Icons.speed_outlined,
            size: 15,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: AppText.num(AppText.caption))),
      ],
    );
  }
}

class _AppOnlyNote extends StatelessWidget {
  const _AppOnlyNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Space.x3),
      decoration: BoxDecoration(
        color: AppColors.raised,
        borderRadius: Radii.button,
        border: Border.all(color: AppColors.hairlineStrong),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.phone_iphone, size: 18, color: AppColors.text),
          const SizedBox(width: Space.x2),
          Expanded(
            child: Text(
              '웹에서는 토스 결제창을 열 수 없어요. 가치가차 앱에서 충전해 주세요. '
              '충전한 GP는 웹에서도 그대로 보여요.',
              style: AppText.caption.copyWith(color: AppColors.text),
            ),
          ),
        ],
      ),
    );
  }
}
