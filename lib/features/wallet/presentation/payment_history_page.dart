import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../data/payment_repository.dart';
import '../domain/payment_models.dart';

/// 결제 내역 (`GET /payments/orders`, 최근 50건).
class PaymentHistoryPage extends StatefulWidget {
  const PaymentHistoryPage({super.key});

  @override
  State<PaymentHistoryPage> createState() => _PaymentHistoryPageState();
}

class _PaymentHistoryPageState extends State<PaymentHistoryPage> {
  static const _repository = PaymentRepository();

  List<PaymentReceipt> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _items.isEmpty;
      _error = null;
    });
    try {
      final items = await _repository.orders();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.displayMessage;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final done = _items.where((i) => i.status == PaymentStatus.done);
    final paid = done.fold<int>(0, (s, i) => s + i.amount);
    final received = done.fold<int>(0, (s, i) => s + i.totalGp);
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('결제 내역')),
      body: _loading
          ? const LoadingView(height: 400)
          : _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : RefreshIndicator(
              color: AppColors.text,
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.only(bottom: Space.x10),
                children: [
                  if (_items.isEmpty)
                    const EmptyView(
                      icon: Icons.receipt_long_outlined,
                      title: '결제 내역이 없어요',
                      message: 'GP를 충전하면 여기에 남아요',
                    )
                  else ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        Space.gutter,
                        Space.x2,
                        Space.gutter,
                        Space.x4,
                      ),
                      child: SurfaceCard(
                        child: Row(
                          children: [
                            _Total(label: '결제한 금액', value: formatWon(paid)),
                            Container(
                              width: 1,
                              height: 32,
                              color: AppColors.hairline,
                            ),
                            _Total(
                              label: '받은 GP',
                              value: formatGp(received),
                              accent: true,
                            ),
                          ],
                        ),
                      ),
                    ),
                    for (var i = 0; i < _items.length; i++) ...[
                      if (i > 0) const Hairline(inset: Space.gutter),
                      PaymentRow(receipt: _items[i]),
                    ],
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        Space.gutter,
                        Space.x4,
                        Space.gutter,
                        0,
                      ),
                      child: Text(
                        '최근 50건까지 보여요. 결제 취소·환불은 고객센터로 문의해 주세요.',
                        style: AppText.caption.copyWith(
                          color: AppColors.textTertiary,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _Total extends StatelessWidget {
  final String label;
  final String value;
  final bool accent;
  const _Total({required this.label, required this.value, this.accent = false});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: AppText.num(AppText.headline).copyWith(
              color: accent ? AppColors.brand : AppColors.text,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: AppText.caption),
        ],
      ),
    );
  }
}

/// 결제 한 건: 상태 · 금액 · 받은 GP(보너스 내역) · 결제수단 · 일시.
class PaymentRow extends StatelessWidget {
  final PaymentReceipt receipt;
  const PaymentRow({super.key, required this.receipt});

  static Color statusColor(PaymentStatus s) => switch (s) {
    PaymentStatus.done => AppColors.brand,
    PaymentStatus.failed => AppColors.danger,
    PaymentStatus.inProgress => AppColors.text,
    _ => AppColors.textTertiary,
  };

  @override
  Widget build(BuildContext context) {
    final r = receipt;
    final when = r.approvedAt ?? r.createdAt;
    final bonusParts = [
      if (r.bonusGp > 0) '대량 +${formatNumber(r.bonusGp)}',
      if (r.firstTopupBonusGp > 0) '첫 충전 +${formatNumber(r.firstTopupBonusGp)}',
    ];
    final meta = [
      if (when != null) formatDateTime(when),
      if (r.method != null) r.method!,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.gutter,
        vertical: 14,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    _StatusPill(status: r.status),
                    const SizedBox(width: 6),
                    Text(
                      formatWon(r.amount),
                      style: AppText.num(AppText.bodyStrong),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  meta.isEmpty ? '-' : meta,
                  style: AppText.num(AppText.caption),
                ),
                const SizedBox(height: 2),
                Text(
                  '주문번호 ${r.orderId}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.num(
                    AppText.micro,
                  ).copyWith(color: AppColors.textTertiary),
                ),
              ],
            ),
          ),
          const SizedBox(width: Space.x2),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                r.status == PaymentStatus.done
                    ? '+${formatGp(r.totalGp)}'
                    : formatGp(r.totalGp),
                style: AppText.num(AppText.bodyStrong).copyWith(
                  color: r.status == PaymentStatus.done
                      ? AppColors.brand
                      : AppColors.textTertiary,
                  decoration:
                      r.status == PaymentStatus.failed ||
                          r.status == PaymentStatus.canceled
                      ? TextDecoration.lineThrough
                      : null,
                ),
              ),
              if (bonusParts.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(bonusParts.join(' · '), style: AppText.num(AppText.micro)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final PaymentStatus status;
  const _StatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    final color = PaymentRow.statusColor(status);
    return Container(
      height: 19,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.chip,
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        status.label,
        style: AppText.micro.copyWith(
          color: color,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
    );
  }
}
