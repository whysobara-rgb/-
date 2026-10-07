import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/shipping_repository.dart';
import '../domain/shipment.dart';

/// 배송 내역: 신청 → 발송 → 배송 완료 단계와 송장번호(복사).
class ShipmentsPage extends StatefulWidget {
  final ShippingRepository repository;

  const ShipmentsPage({
    super.key,
    this.repository = const ShippingRepository(),
  });

  static Route<void> route() =>
      MaterialPageRoute<void>(builder: (_) => const ShipmentsPage());

  @override
  State<ShipmentsPage> createState() => _ShipmentsPageState();
}

class _ShipmentsPageState extends State<ShipmentsPage> {
  List<Shipment> _items = const [];
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
      final items = await widget.repository.list();
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
    final active = _items.where((s) => s.isActive).length;
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('배송 내역')),
      body: _loading
          ? const LoadingView(height: 400)
          : _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : RefreshIndicator(
              color: AppColors.text,
              onRefresh: _load,
              child: _items.isEmpty
                  ? ListView(
                      children: const [
                        EmptyView(
                          icon: Icons.local_shipping_outlined,
                          title: '배송 신청 내역이 없어요',
                          message: '보관함에서 상품을 골라 배송을 신청할 수 있어요',
                        ),
                      ],
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(
                        Space.gutter,
                        Space.x2,
                        Space.gutter,
                        Space.x10,
                      ),
                      itemCount: _items.length + 1,
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: Space.x3),
                      itemBuilder: (_, i) {
                        if (i == 0) {
                          return Text(
                            active > 0
                                ? '진행 중 $active건 · 전체 ${_items.length}건'
                                : '전체 ${_items.length}건 · 모두 배송 완료',
                            style: AppText.num(AppText.caption),
                          );
                        }
                        return ShipmentCard(shipment: _items[i - 1]);
                      },
                    ),
            ),
    );
  }
}

/// 배송 한 건 카드.
class ShipmentCard extends StatelessWidget {
  final Shipment shipment;
  const ShipmentCard({super.key, required this.shipment});

  @override
  Widget build(BuildContext context) {
    final s = shipment;
    return SurfaceCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.x4,
              Space.x4,
              Space.x4,
              Space.x2,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.itemSummary,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.headline,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          '배송 #${s.id}',
                          if (s.createdAt != null)
                            '${formatDateTime(s.createdAt!)} 신청',
                        ].join(' · '),
                        style: AppText.num(AppText.caption),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Space.x2),
                ShipmentStatusPill(status: s.status),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Space.x4,
              vertical: Space.x3,
            ),
            child: ShipmentSteps(shipment: s),
          ),
          if (s.hasTracking)
            _TrackingRow(company: s.trackingCompany!, number: s.trackingNumber!)
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.x4,
                0,
                Space.x4,
                Space.x3,
              ),
              child: Text('발송되면 택배사와 송장번호가 여기에 나와요.', style: AppText.caption),
            ),
          const Hairline(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.x4,
              Space.x3,
              Space.x4,
              Space.x3,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in s.items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        RarityTag(item.rarity, dense: true),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            item.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.callout.copyWith(
                              color: AppColors.text,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 2),
                Text(
                  '${s.recipientName} · ${s.maskedPhone}\n${s.address}',
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

class ShipmentStatusPill extends StatelessWidget {
  final ShipmentStatus status;
  const ShipmentStatusPill({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      ShipmentStatus.requested => AppColors.textSecondary,
      ShipmentStatus.shipping => AppColors.brand,
      ShipmentStatus.delivered => AppColors.text,
    };
    return Container(
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.pill,
        border: Border.all(color: color.withValues(alpha: 0.5)),
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

/// 신청 → 발송 → 배송 완료 세 단계와 각 시각.
class ShipmentSteps extends StatelessWidget {
  final Shipment shipment;
  const ShipmentSteps({super.key, required this.shipment});

  @override
  Widget build(BuildContext context) {
    final s = shipment;
    final steps = [
      ('배송 신청', s.createdAt),
      ('발송', s.shippedAt),
      ('배송 완료', s.deliveredAt),
    ];
    final current = s.status.step;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++) ...[
          Expanded(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: i == 0
                          ? const SizedBox()
                          : Container(
                              height: 2,
                              color: i <= current
                                  ? AppColors.brand
                                  : AppColors.high,
                            ),
                    ),
                    _Dot(done: i <= current, current: i == current),
                    Expanded(
                      child: i == steps.length - 1
                          ? const SizedBox()
                          : Container(
                              height: 2,
                              color: i < current
                                  ? AppColors.brand
                                  : AppColors.high,
                            ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  steps[i].$1,
                  style: AppText.caption.copyWith(
                    color: i <= current
                        ? AppColors.text
                        : AppColors.textTertiary,
                    fontWeight: i == current ? FontWeight.w700 : null,
                  ),
                ),
                Text(
                  steps[i].$2 != null && i <= current
                      ? formatMonthDay(steps[i].$2!)
                      : '-',
                  style: AppText.num(
                    AppText.micro,
                  ).copyWith(color: AppColors.textTertiary),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  final bool done;
  final bool current;
  const _Dot({required this.done, required this.current});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 14,
      height: 14,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? AppColors.brand : AppColors.surface,
        border: Border.all(
          color: done ? AppColors.brand : AppColors.hairlineStrong,
          width: 2,
        ),
        boxShadow: current
            ? [
                BoxShadow(
                  color: AppColors.brand.withValues(alpha: 0.45),
                  blurRadius: 8,
                ),
              ]
            : null,
      ),
    );
  }
}

class _TrackingRow extends StatelessWidget {
  final String company;
  final String number;
  const _TrackingRow({required this.company, required this.number});

  Future<void> _copy(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: number));
    if (context.mounted) showToast(context, '송장번호를 복사했어요');
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.x4, 0, Space.x3, Space.x3),
      child: Container(
        padding: const EdgeInsets.fromLTRB(Space.x3, 10, Space.x1, 10),
        decoration: BoxDecoration(
          color: AppColors.raised,
          borderRadius: Radii.button,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.local_shipping_outlined,
              size: 18,
              color: AppColors.textSecondary,
            ),
            const SizedBox(width: Space.x2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(company, style: AppText.caption),
                  SelectableText(
                    number,
                    style: AppText.num(AppText.bodyStrong),
                  ),
                ],
              ),
            ),
            TextButton.icon(
              onPressed: () => _copy(context),
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('복사'),
              style: TextButton.styleFrom(
                minimumSize: const Size(0, 36),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                textStyle: AppText.callout.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
