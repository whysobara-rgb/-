import '../../customer_updates/customer_updates_page.dart';
import '../../account_security/account_security_page.dart';
import '../../refunds/order_history_page.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/balance_notice.dart';
import '../../shipping/presentation/shipping_history_page.dart';
import '../../inventory/presentation/inventory_page.dart';
import '../../wallet/presentation/point_history_page.dart';
import '../../conversions/conversion_page.dart';

class ProfilePage extends StatefulWidget {
  final VoidCallback onGoToWallet;
  const ProfilePage({super.key, required this.onGoToWallet});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  void _confirmLogout(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('로그아웃', style: TextStyle(fontWeight: FontWeight.w700)),
          content: const Text('로그아웃 하시겠습니까?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('취소', style: TextStyle(color: AppColors.textSecondary)),
            ),
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await context.read<AuthProvider>().logout();
              },
              child: const Text('로그아웃', style: TextStyle(
                  color: AppColors.error, fontWeight: FontWeight.w700)),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;
    final gp = context.watch<GpProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('마이')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(28),
              gradient: const LinearGradient(
                colors: [Color(0xFF29203E), Color(0xFF101018)],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.person_outline_rounded, color: Color(0xFFB9A4FF), size: 44),
                const SizedBox(height: 20),
                Text(user?.nickname ?? '내 계정', style: const TextStyle(
                    color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(user?.maskedEmail ?? '', style: const TextStyle(color: Color(0xFFD8D3E3))),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Card(child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('보유 GP'),
                const SizedBox(height: 8),
                Text('${gp.formattedBalance} GP', style: const TextStyle(
                    fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                FilledButton(onPressed: widget.onGoToWallet, child: const Text('GP 지갑 보기')),
              ],
            ),
          )),
          const BalanceNotice(),
          const SizedBox(height: 20),
          const Text('내 활동', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Card(child: Column(children: [
            ListTile(
              key: const Key('profile-order-history'),
              leading: const Icon(Icons.receipt_long),
              title: const Text('주문·환불 내역'),
              subtitle: const Text('구매 내역 · 미개봉 환불 · 처리 결과 확인'),
              trailing: const Icon(Icons.chevron_right),
              onTap: user == null ? null : () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const OrderHistoryPage()),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.swap_horiz),
              title: const Text('GP 전환 · 상품 복구'),
              subtitle: const Text('전환 내역과 복구 가능 여부 확인'),
              trailing: const Icon(Icons.chevron_right),
              onTap: user == null ? null : () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => ConversionPage(userId: user.id)),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.collections_bookmark_outlined),
              title: const Text('내 컬렉션'),
              subtitle: const Text('획득한 상품과 배송 상태 확인'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const InventoryPage()),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined),
              title: const Text('배송 내역'),
              subtitle: const Text('신청 상품과 진행 상태 확인'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ShippingHistoryPage()),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.support_agent),
              title: const Text('소식·고객지원'),
              subtitle: const Text('이벤트·공지·문의·교환 처리 현황'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CustomerUpdatesPage(initial: 'tickets')),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('포인트 내역'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PointHistoryPage()),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              key: const Key('profile-account-security'),
              leading: const Icon(Icons.security),
              title: const Text('계정 보안'),
              subtitle: const Text('비밀번호 변경 · 모든 로그인 해제'),
              trailing: const Icon(Icons.chevron_right),
              onTap: user == null ? null : () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AccountSecurityPage()),
              ),
            ),
          ])),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => _confirmLogout(context),
            icon: const Icon(Icons.logout),
            label: const Text('로그아웃'),
          ),
        ],
      ),
    );
  }
}
