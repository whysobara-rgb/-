import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../shipping/domain/shipment.dart';
import '../data/admin_repository.dart';
import 'admin_banners_tab.dart';
import 'admin_boxes_tab.dart';
import 'admin_dashboard_tab.dart';
import 'admin_payments_tab.dart';
import 'admin_shipping_tab.dart';

/// 운영자 모드(ADMIN 전용). MY에서 role == ADMIN일 때만 들어온다.
///
/// 서버가 `/admin/*` 요청마다 권한을 다시 확인하므로, 화면 진입 조건은
/// 편의일 뿐 보안 경계가 아니다.
class AdminHomePage extends StatefulWidget {
  final AdminRepository repository;

  const AdminHomePage({super.key, this.repository = const AdminRepository()});

  static Route<void> route() => MaterialPageRoute<void>(
    settings: const RouteSettings(name: '/admin'),
    builder: (_) => const AdminHomePage(),
  );

  @override
  State<AdminHomePage> createState() => _AdminHomePageState();
}

class _AdminHomePageState extends State<AdminHomePage>
    with SingleTickerProviderStateMixin {
  static const _tabs = ['대시보드', '배송', '박스', '배너', '결제'];

  late final TabController _controller = TabController(
    length: _tabs.length,
    vsync: this,
  );

  /// 대시보드의 "처리할 일"에서 해당 탭과 필터로 바로 간다.
  final _shippingFilter = ValueNotifier<ShipmentStatus?>(
    ShipmentStatus.requested,
  );
  final _paymentFilter = ValueNotifier<String?>(null);

  @override
  void dispose() {
    _controller.dispose();
    _shippingFilter.dispose();
    _paymentFilter.dispose();
    super.dispose();
  }

  void _openShipping(ShipmentStatus status) {
    _shippingFilter.value = status;
    _controller.animateTo(1);
  }

  void _openPayments(String? status) {
    _paymentFilter.value = status;
    _controller.animateTo(4);
  }

  @override
  Widget build(BuildContext context) {
    final repo = widget.repository;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            const Text('운영자 모드'),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.danger.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                  color: AppColors.danger.withValues(alpha: 0.5),
                ),
              ),
              child: Text(
                'ADMIN',
                style: AppText.micro.copyWith(
                  color: AppColors.danger,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.8,
                ),
              ),
            ),
          ],
        ),
        bottom: TabBar(
          controller: _controller,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [for (final t in _tabs) Tab(text: t, height: 40)],
        ),
      ),
      body: TabBarView(
        controller: _controller,
        children: [
          AdminDashboardTab(
            repository: repo,
            onOpenShipping: _openShipping,
            onOpenPayments: _openPayments,
          ),
          AdminShippingTab(repository: repo, filter: _shippingFilter),
          AdminBoxesTab(repository: repo),
          AdminBannersTab(repository: repo),
          AdminPaymentsTab(repository: repo, filter: _paymentFilter),
        ],
      ),
    );
  }
}
