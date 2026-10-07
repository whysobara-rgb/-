import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../../shipping/domain/shipment.dart';
import '../../shipping/presentation/shipments_page.dart';
import '../data/admin_repository.dart';
import '../domain/admin_forms.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';

/// 배송 큐: 오래된 신청부터. REQUESTED → 발송 처리(송장) → 배송 완료.
class AdminShippingTab extends StatefulWidget {
  final AdminRepository repository;
  final ValueNotifier<ShipmentStatus?> filter;

  const AdminShippingTab({
    super.key,
    required this.repository,
    required this.filter,
  });

  @override
  State<AdminShippingTab> createState() => _AdminShippingTabState();
}

class _AdminShippingTabState extends State<AdminShippingTab>
    with AutomaticKeepAliveClientMixin {
  AdminList<Shipment>? _list;
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;

  /// 카드별 서버 오류(10001/10005 등).
  final Map<int, String> _cardErrors = {};
  final Set<int> _busy = {};

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
      _cardErrors.clear();
    });
    try {
      final list = await widget.repository.shipping(
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
      final next = await widget.repository.shipping(
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

  Future<void> _ship(Shipment s) async {
    final done = await showAppSheet<bool>(
      context: context,
      title: s.status == ShipmentStatus.shipping ? '송장 수정' : '발송 처리',
      builder: (_) => ShipSheet(shipment: s, repository: widget.repository),
    );
    if (done == true && mounted) {
      showToast(context, '#${s.id} 발송 처리했어요');
      _load();
    }
  }

  Future<void> _deliver(Shipment s) async {
    final ok = await showAppSheet<bool>(
      context: context,
      title: '배송 완료로 바꿀까요?',
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          0,
          Space.gutter,
          Space.x4,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '#${s.id} ${s.itemSummary} · ${s.recipientName}\n'
              '${s.trackingCompany ?? ''} ${s.trackingNumber ?? ''}',
              style: AppText.callout,
            ),
            const SizedBox(height: Space.x4),
            PrimaryButton(
              label: '배송 완료',
              onPressed: () => Navigator.of(sheet).pop(true),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy.add(s.id);
      _cardErrors.remove(s.id);
    });
    try {
      await widget.repository.markDelivered(s.id);
      if (!mounted) return;
      showToast(context, '#${s.id} 배송 완료로 바꿨어요');
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _cardErrors[s.id] = e.displayMessage);
    } finally {
      if (mounted) setState(() => _busy.remove(s.id));
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
          builder: (_, value, _) => AdminFilterBar<ShipmentStatus?>(
            value: value,
            onChanged: (v) => widget.filter.value = v,
            options: const [
              ('발송 대기', ShipmentStatus.requested),
              ('배송 중', ShipmentStatus.shipping),
              ('배송 완료', ShipmentStatus.delivered),
              ('전체', null),
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
                              icon: Icons.local_shipping_outlined,
                              title: '처리할 배송이 없어요',
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
                              '${formatNumber(list.totalCount)}건 · 오래된 신청부터',
                              style: AppText.num(AppText.caption),
                            ),
                            const SizedBox(height: Space.x2),
                            for (final s in list.items) ...[
                              _QueueCard(
                                shipment: s,
                                busy: _busy.contains(s.id),
                                error: _cardErrors[s.id],
                                onShip: () => _ship(s),
                                onDeliver: () => _deliver(s),
                              ),
                              const SizedBox(height: Space.x2),
                            ],
                            if (list.hasMore)
                              OutlinedButton(
                                onPressed: _loadingMore ? null : _more,
                                child: Text(
                                  _loadingMore
                                      ? '불러오는 중…'
                                      : '더 보기 (${list.items.length}/${list.totalCount})',
                                ),
                              ),
                          ],
                        ),
                ),
        ),
      ],
    );
  }
}

class _QueueCard extends StatelessWidget {
  final Shipment shipment;
  final bool busy;
  final String? error;
  final VoidCallback onShip;
  final VoidCallback onDeliver;

  const _QueueCard({
    required this.shipment,
    required this.busy,
    required this.error,
    required this.onShip,
    required this.onDeliver,
  });

  @override
  Widget build(BuildContext context) {
    final s = shipment;
    final value = s.items.fold<int>(
      0,
      (sum, i) => sum + (i.estimatedValue ?? 0),
    );
    return SurfaceCard(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text('#${s.id}', style: AppText.num(AppText.bodyStrong)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  [s.userNickname, s.userEmail].whereType<String>().join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ),
              ShipmentStatusPill(status: s.status),
            ],
          ),
          const SizedBox(height: 6),
          for (final item in s.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  RarityTag(item.rarity, dense: true),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption.copyWith(color: AppColors.text),
                    ),
                  ),
                  if (item.estimatedValue != null)
                    Text(
                      formatWon(item.estimatedValue!),
                      style: AppText.num(AppText.micro),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 4),
          KeyValue('받는 분', '${s.recipientName} · ${s.phone}', mono: true),
          KeyValue('주소', s.address),
          if (s.notes != null) KeyValue('요청', s.notes!),
          KeyValue(
            '신청',
            [
              if (s.createdAt != null) formatDateTime(s.createdAt!),
              '정가 ${formatWon(value)}',
            ].join(' · '),
            mono: true,
          ),
          if (s.hasTracking)
            KeyValue(
              '송장',
              '${s.trackingCompany} ${s.trackingNumber}'
                  '${s.shippedAt != null ? ' · ${formatDateTime(s.shippedAt!)} 발송' : ''}',
              mono: true,
            ),
          if (s.deliveredAt != null)
            KeyValue('완료', formatDateTime(s.deliveredAt!), mono: true),
          if (error != null) ...[
            const SizedBox(height: 6),
            InlineError(error!),
          ],
          if (s.status != ShipmentStatus.delivered) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                if (s.status == ShipmentStatus.shipping) ...[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : onShip,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 38),
                      ),
                      child: const Text('송장 수정'),
                    ),
                  ),
                  const SizedBox(width: Space.x2),
                ],
                Expanded(
                  child: FilledButton(
                    onPressed: busy
                        ? null
                        : s.status == ShipmentStatus.requested
                        ? onShip
                        : onDeliver,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 38),
                    ),
                    child: Text(
                      s.status == ShipmentStatus.requested ? '발송 처리' : '배송 완료',
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// 발송 처리 시트: 택배사 + 송장번호. 서버 오류는 시트 안에 보여준다.
class ShipSheet extends StatefulWidget {
  final Shipment shipment;
  final AdminRepository repository;

  const ShipSheet({
    super.key,
    required this.shipment,
    required this.repository,
  });

  @override
  State<ShipSheet> createState() => _ShipSheetState();
}

class _ShipSheetState extends State<ShipSheet> {
  late String _company = widget.shipment.trackingCompany ?? '';
  late bool _custom =
      _company.isNotEmpty && !ShipForm.companies.contains(_company);
  late final _customCompany = TextEditingController(
    text: _custom ? _company : '',
  );
  late final _number = TextEditingController(
    text: widget.shipment.trackingNumber ?? '',
  );
  Map<String, String> _errors = const {};
  String? _serverError;
  bool _saving = false;

  @override
  void dispose() {
    _customCompany.dispose();
    _number.dispose();
    super.dispose();
  }

  ShipForm get _form => ShipForm(
    company: _custom ? _customCompany.text : _company,
    trackingNumber: _number.text,
  );

  Future<void> _submit() async {
    final form = _form;
    final errors = form.validate();
    setState(() {
      _errors = errors;
      _serverError = null;
    });
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      await widget.repository.ship(widget.shipment.id, form);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _serverError = e.displayMessage;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.shipment;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x4,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '#${s.id} ${s.itemSummary}\n${s.recipientName} · ${s.address}',
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x4),
          Text('택배사', style: AppText.bodyStrong),
          const SizedBox(height: Space.x2),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final c in ShipForm.companies)
                AdminChip(
                  label: c,
                  selected: !_custom && _company == c,
                  onTap: () => setState(() {
                    _custom = false;
                    _company = c;
                    _errors = {..._errors}..remove('company');
                  }),
                ),
              AdminChip(
                label: '직접 입력',
                selected: _custom,
                onTap: () => setState(() {
                  _custom = true;
                  _errors = {..._errors}..remove('company');
                }),
              ),
            ],
          ),
          if (_custom) ...[
            const SizedBox(height: Space.x2),
            TextField(
              controller: _customCompany,
              decoration: const InputDecoration(
                labelText: '택배사 이름',
                hintText: '예: 경동택배',
              ),
            ),
          ],
          if (_errors['company'] != null) ...[
            const SizedBox(height: 6),
            Text(
              _errors['company']!,
              style: AppText.caption.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: Space.x4),
          TextField(
            controller: _number,
            keyboardType: TextInputType.number,
            onChanged: (_) {
              if (_errors.containsKey('trackingNumber')) {
                setState(
                  () => _errors = {..._errors}..remove('trackingNumber'),
                );
              }
            },
            style: AppText.num(AppText.body),
            decoration: InputDecoration(
              labelText: '송장번호',
              hintText: '숫자만 또는 하이픈 포함',
              errorText: _errors['trackingNumber'],
            ),
          ),
          if (_serverError != null) ...[
            const SizedBox(height: Space.x3),
            InlineError(_serverError!),
          ],
          const SizedBox(height: Space.x4),
          PrimaryButton(
            label: s.status == ShipmentStatus.shipping ? '송장 수정' : '발송 처리',
            loading: _saving,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}
