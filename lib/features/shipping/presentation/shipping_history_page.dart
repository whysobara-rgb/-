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
    appBar: AppBar(title: const Text('배송 내역')),
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
                builder: (_) => ShippingDetailPage(request: request),
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

class ShippingDetailPage extends StatelessWidget {
  final ShippingRequest request;
  const ShippingDetailPage({super.key, required this.request});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('배송 신청 상세')),
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
            for (final status in ShippingStatus.values)
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
          _section('받는 정보', [
            Text(
              request.recipient,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(request.phone),
            const SizedBox(height: 8),
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
