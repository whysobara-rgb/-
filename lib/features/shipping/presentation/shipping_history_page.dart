import 'package:provider/provider.dart';
import '../../../core/config/app_config.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../orders/order_repository.dart';
import '../fulfillment_repository.dart';
import '../../inventory/presentation/delivery_request_page.dart';
import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/activity_feed.dart';
import '../domain/shipping_request.dart';

class ShippingHistoryPage extends StatelessWidget {
  final ShippingRepository repository;
  const ShippingHistoryPage({
    super.key,
    this.repository = const ShippingRepository(),
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('배송 내역'),
      actions: [
        IconButton(
          tooltip: '배송 신청 결과 확인',
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => const DeliveryRequestPage(items: []),
            ),
          ),
          icon: const Icon(Icons.sync),
        ),
      ],
    ),
    body: SafeArea(
      child: ActivityFeed<ShippingRequest>(
        loadPage: (page) => repository.getPage(page: page),
        id: (request) => request.id,
        emptyTitle: '아직 배송 신청이 없어요',
        emptyDescription: '배송을 신청한 상품과 진행 상태를\n이곳에 모아 보여드려요.',
        emptyIcon: Icons.local_shipping_outlined,
        header: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '설렘이 도착하는 중',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
            ),
            SizedBox(height: 10),
            Text(
              '신청한 상품이 어디까지 왔는지 확인하세요.',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ],
        ),
        itemBuilder: (request) => Card(
          margin: const EdgeInsets.only(bottom: 14),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ShippingDetailPage(
                  request: request,
                  repository: repository,
                ),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Status(request.status),
                  const SizedBox(height: 16),
                  Text(
                    request.products.first.name,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '총 ${request.products.length}개 상품 · ${request.dateLabel}',
                    style: const TextStyle(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Expanded(child: Text('신청 상세 보기')),
                      Icon(Icons.arrow_forward_rounded, size: 20),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _Status extends StatelessWidget {
  final ShippingStatus status;
  const _Status(this.status);
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: const Color(0xFFF0EBFF),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      status.label,
      style: const TextStyle(
        color: Color(0xFF5F3BBC),
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class ShippingDetailPage extends StatefulWidget {
  final ShippingRequest request;
  final ShippingRepository repository;
  const ShippingDetailPage({
    super.key,
    required this.request,
    this.repository = const ShippingRepository(),
  });
  @override
  State<ShippingDetailPage> createState() => _ShippingDetailPageState();
}

class _ShippingDetailPageState extends State<ShippingDetailPage> {
  late ShippingRequest request = widget.request;
  bool loading = false;
  Future<void> refresh() async {
    setState(() => loading = true);
    try {
      final latest = await widget.repository.getOne(request.id);
      if (mounted) {
        setState(() => request = latest);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  Future<void> cancel() async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('배송 신청을 취소할까요?'),
        content: Text(
          '상품을 보관함으로 되돌리고 배송비 ${request.feeGP} GP를 돌려받습니다. 택배사 인계 전까지만 가능합니다.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('유지'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('취소 확인'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) {
      return;
    }
    setState(() => loading = true);
    try {
      final id = context.read<AuthProvider>().currentUser?.id;
      if (id == null) {
        throw Exception('다시 로그인해주세요');
      }
      final r = FulfillmentRepository(await OrderRepository.forUser(id));
      final result = await r.cancel(request.id);
      if (!mounted) {
        return;
      }
      setState(() => request = result);
      await context.read<AuthProvider>().refreshProfile();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e · 결과가 불명확하면 배송 내역의 요청 결과 확인을 이용하세요.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('배송 신청 상세'),
      actions: [
        IconButton(
          tooltip: '배송 상태 새로고침',
          onPressed: loading ? null : refresh,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: AppColors.heroGradient,
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.local_shipping_outlined,
                  color: Colors.white,
                  size: 44,
                ),
                const SizedBox(height: 20),
                Text(
                  request.status.label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  '${request.dateLabel} 신청 · ${request.products.length}개 상품',
                  style: const TextStyle(color: Colors.white),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _section('진행 상태', [
            for (final status
                in request.status == ShippingStatus.cancelled
                    ? [ShippingStatus.cancelled]
                    : ShippingStatus.values.where(
                        (s) => s != ShippingStatus.cancelled,
                      ))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    Icon(
                      status.index <= request.status.index
                          ? Icons.check_circle_rounded
                          : Icons.radio_button_unchecked,
                      color: status.index <= request.status.index
                          ? AppColors.accentViolet
                          : AppColors.textSecondary,
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(status.label)),
                    if (status == request.status)
                      const Text(
                        '현재',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                  ],
                ),
              ),
          ]),
          const SizedBox(height: 20),
          if (AppConfig.shippingPreviewEnabled &&
              [
                ShippingStatus.requested,
                ShippingStatus.preparing,
              ].contains(request.status))
            OutlinedButton(
              onPressed: loading ? null : cancel,
              child: const Text('배송 신청 취소·배송비 환급'),
            ),
          _section('추적 정보', [
            SelectableText('배송번호 ${request.id}'),
            Text('배송비 ${request.feeGP} GP'),
            if (request.trackingNumber != null) ...[
              Text('택배사 ${request.carrier ?? '미등록'}'),
              SelectableText('운송장 ${request.trackingNumber}'),
            ],
            const Text('운영자가 확인하여 기록한 배송 상태입니다.'),
          ]),
          const SizedBox(height: 20),
          _section('받는 정보', [
            Text(
              request.recipient,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(request.phone),
            const SizedBox(height: 8),
            Text(request.postalCode),
            Text(request.address),
            if (request.notes != null) ...[
              const SizedBox(height: 12),
              Text('요청사항: ${request.notes}'),
            ],
          ]),
          const SizedBox(height: 20),
          _section('신청 상품', [
            for (final product in request.products)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.card_giftcard_rounded,
                      color: AppColors.accentViolet,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            product.name,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '보관함 번호 ${product.inventoryId}',
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ]),
          const SizedBox(height: 20),
          SelectableText(
            '배송 신청 번호 ${request.id}',
            style: const TextStyle(color: AppColors.textSecondary),
          ),
        ],
      ),
    ),
  );
  Widget _section(String title, List<Widget> children) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    ),
  );
}
