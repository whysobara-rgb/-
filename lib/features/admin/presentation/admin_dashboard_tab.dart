import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../../shipping/domain/shipment.dart';
import '../data/admin_repository.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';

/// 대시보드: 오늘·이번 달·누적 지표와 처리할 일.
class AdminDashboardTab extends StatefulWidget {
  final AdminRepository repository;
  final ValueChanged<ShipmentStatus> onOpenShipping;
  final ValueChanged<String?> onOpenPayments;

  const AdminDashboardTab({
    super.key,
    required this.repository,
    required this.onOpenShipping,
    required this.onOpenPayments,
  });

  @override
  State<AdminDashboardTab> createState() => _AdminDashboardTabState();
}

class _AdminDashboardTabState extends State<AdminDashboardTab>
    with AutomaticKeepAliveClientMixin {
  AdminStats? _stats;
  String? _error;
  DateTime? _loadedAt;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final stats = await widget.repository.stats();
      if (!mounted) return;
      setState(() {
        _stats = stats;
        _error = null;
        _loadedAt = DateTime.now();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.displayMessage);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = _stats;
    if (s == null) {
      return _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : const LoadingView(height: 400);
    }
    return RefreshIndicator(
      color: AppColors.text,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          0,
          Space.gutter,
          Space.x10,
        ),
        children: [
          AdminSectionTitle(
            '처리할 일',
            trailing: _loadedAt == null
                ? null
                : '${formatDateTime(_loadedAt!)} 기준',
          ),
          TileGrid(
            children: [
              KpiTile(
                label: '발송 대기',
                value: '${formatNumber(s.shipmentsToSend)}건',
                accent: s.shipmentsToSend > 0,
                onTap: () => widget.onOpenShipping(ShipmentStatus.requested),
              ),
              KpiTile(
                label: '배송 중',
                value: '${formatNumber(s.shipmentsInTransit)}건',
                onTap: () => widget.onOpenShipping(ShipmentStatus.shipping),
              ),
              KpiTile(
                label: '확인 필요 결제',
                value: '${formatNumber(s.paymentsToReview)}건',
                note: '환불·금액 불일치·10분 넘게 확인 중',
                accent: s.paymentsToReview > 0,
                onTap: () => widget.onOpenPayments(null),
              ),
            ],
          ),
          const AdminSectionTitle('오늘'),
          TileGrid(
            children: [
              KpiTile(
                label: '매출',
                value: formatWon(s.todayRevenue),
                note: '결제 회원 ${formatNumber(s.todayPayingUsers)}명',
              ),
              KpiTile(
                label: '뽑기',
                value: '${formatNumber(s.todayDraws)}회',
                note: '사용 ${formatGp(s.todayGpSpent)}',
              ),
              KpiTile(
                label: '신규 가입',
                value: '${formatNumber(s.todayNewUsers)}명',
              ),
            ],
          ),
          const AdminSectionTitle('이번 달'),
          TileGrid(
            children: [
              KpiTile(label: '매출', value: formatWon(s.monthRevenue)),
              KpiTile(
                label: '결제 회원',
                value: '${formatNumber(s.monthPayingUsers)}명',
              ),
            ],
          ),
          const AdminSectionTitle('누적'),
          TileGrid(
            children: [
              KpiTile(label: '매출', value: formatWon(s.totalRevenue)),
              KpiTile(
                label: '뽑기',
                value: '${formatNumber(s.totalDraws)}회',
                note: '사용 ${formatGp(s.totalGpSpent)}',
              ),
              KpiTile(label: '회원', value: '${formatNumber(s.totalUsers)}명'),
              KpiTile(
                label: '미사용 GP',
                value: formatGp(s.gpOutstanding),
                note: '회원이 가진 선불 가치',
              ),
            ],
          ),
          const SizedBox(height: Space.x4),
          Text(
            '매출은 토스 승인(DONE) 결제만 더한 값이에요. 날짜는 한국 시간 기준이에요.',
            style: AppText.caption.copyWith(color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}
