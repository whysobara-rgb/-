import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../../wallet/domain/payment_models.dart';
import '../../wallet/presentation/payment_history_page.dart';
import '../data/admin_repository.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';

/// 결제 내역(상태 필터, 실패 사유). 결제 대기(READY)는 서버가 빼고 준다.
class AdminPaymentsTab extends StatefulWidget {
  final AdminRepository repository;
  final ValueNotifier<String?> filter;

  const AdminPaymentsTab({
    super.key,
    required this.repository,
    required this.filter,
  });

  @override
  State<AdminPaymentsTab> createState() => _AdminPaymentsTabState();
}

class _AdminPaymentsTabState extends State<AdminPaymentsTab>
    with AutomaticKeepAliveClientMixin {
  AdminList<AdminPayment>? _list;
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    widget.filter.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    widget.filter.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await widget.repository.payments(
        status: widget.filter.value,
      );
      if (!mounted) return;
      setState(() {
        _list = list;
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

  Future<void> _more() async {
    final list = _list;
    if (list == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await widget.repository.payments(
        status: widget.filter.value,
        page: list.items.length ~/ 50 + 1,
      );
      if (!mounted) return;
      setState(() {
        _list = AdminList([...list.items, ...next.items], next.totalCount);
      });
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final list = _list;
    return Column(
      children: [
        ValueListenableBuilder(
          valueListenable: widget.filter,
          builder: (_, value, _) => AdminFilterBar<String?>(
            value: value,
            onChanged: (v) => widget.filter.value = v,
            options: [
              ('전체', null),
              for (final s in [
                PaymentStatus.done,
                PaymentStatus.inProgress,
                PaymentStatus.failed,
                PaymentStatus.canceled,
              ])
                (s.label, s.code),
            ],
          ),
        ),
        Expanded(
          child: _loading && list == null
              ? const LoadingView(height: 300)
              : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  color: AppColors.text,
                  onRefresh: _load,
                  child: list == null || list.items.isEmpty
                      ? ListView(
                          children: const [
                            EmptyView(
                              icon: Icons.credit_card_outlined,
                              title: '결제가 없어요',
                              height: 240,
                            ),
                          ],
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(
                            Space.gutter,
                            Space.x1,
                            Space.gutter,
                            Space.x10,
                          ),
                          children: [
                            Text(
                              '${formatNumber(list.totalCount)}건 · 최근 순',
                              style: AppText.num(AppText.caption),
                            ),
                            const SizedBox(height: Space.x2),
                            for (var i = 0; i < list.items.length; i++) ...[
                              if (i > 0) const Hairline(),
                              _PaymentRow(payment: list.items[i]),
                            ],
                            if (list.hasMore) ...[
                              const SizedBox(height: Space.x3),
                              OutlinedButton(
                                onPressed: _loadingMore ? null : _more,
                                child: Text(
                                  _loadingMore
                                      ? '불러오는 중…'
                                      : '더 보기 (${list.items.length}/${list.totalCount})',
                                ),
                              ),
                            ],
                          ],
                        ),
                ),
        ),
      ],
    );
  }
}

class _PaymentRow extends StatelessWidget {
  final AdminPayment payment;
  const _PaymentRow({required this.payment});

  @override
  Widget build(BuildContext context) {
    final p = payment;
    final when = p.approvedAt ?? p.createdAt;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              StatusTag(
                p.status.label,
                color: PaymentRow.statusColor(p.status),
              ),
              const SizedBox(width: 6),
              Text(formatWon(p.amount), style: AppText.num(AppText.bodyStrong)),
              const SizedBox(width: 6),
              Text(
                '→ ${formatGp(p.totalGp)}',
                style: AppText.num(AppText.caption),
              ),
              const Spacer(),
              Text(
                when == null ? '-' : formatDateTime(when),
                style: AppText.num(AppText.micro),
              ),
            ],
          ),
          const SizedBox(height: 4),
          KeyValue('회원', '${p.userNickname} (#${p.userId})'),
          if (p.method != null) KeyValue('수단', p.method!),
          KeyValue('주문', p.orderId, mono: true),
          if (p.paymentKey != null)
            Row(
              children: [
                Expanded(child: KeyValue('키', p.paymentKey!, mono: true)),
                InkWell(
                  onTap: () async {
                    await Clipboard.setData(ClipboardData(text: p.paymentKey!));
                    if (context.mounted) {
                      showToast(context, 'paymentKey를 복사했어요');
                    }
                  },
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(
                      Icons.copy,
                      size: 14,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
          if (p.failureReason != null) ...[
            const SizedBox(height: 4),
            InlineError('실패 사유: ${p.failureReason}'),
          ],
        ],
      ),
    );
  }
}
