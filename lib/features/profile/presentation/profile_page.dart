import '../../customer_updates/customer_updates_page.dart';
import '../../account_security/account_security_page.dart';
import '../../refunds/order_history_page.dart';
import '../../recovery/recovery_page.dart';
import '../../closure/closure_page.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/gachi_components.dart';
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
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          '로그아웃',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        content: const Text('로그아웃 하시겠습니까?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text(
              '취소',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await context.read<AuthProvider>().logout();
            },
            child: const Text(
              '로그아웃',
              style: TextStyle(
                color: AppColors.error,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;
    final gp = context.watch<GpProvider>();
    return GachiScaffold(
      title: '마이',
      body: ListView(
        padding: const EdgeInsets.all(GachiSpace.page),
        children: [
          GachiInfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Icon(
                    Icons.person_outline_rounded,
                    color: GachiColors.secondary,
                    size: 32,
                  ),
                ),
                const SizedBox(height: GachiSpace.md),
                Text(user?.nickname ?? '내 계정', style: GachiType.section),
                const SizedBox(height: GachiSpace.xs),
                Text(
                  user?.maskedEmail ?? '',
                  style: GachiType.meta.copyWith(color: GachiColors.secondary),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: GachiSpace.lg),
                  child: Divider(),
                ),
                const Text('보유 GP', style: GachiType.meta),
                const SizedBox(height: GachiSpace.sm),
                Text('${gp.formattedBalance} GP', style: GachiType.display),
                const SizedBox(height: GachiSpace.md),
                GachiSecondaryButton(
                  onPressed: widget.onGoToWallet,
                  label: 'GP 지갑 보기',
                ),
              ],
            ),
          ),
          const BalanceNotice(),
          const SizedBox(height: 20),
          const GachiSectionHeader(title: '내 활동 · 계정'),
          const SizedBox(height: 12),
          GachiInfoCard(
            child: Column(
              children: [
                ListTile(
                  key: const Key('profile-order-history'),
                  leading: const Icon(Icons.receipt_long),
                  title: const Text('주문·환불 내역'),
                  subtitle: const Text('구매 내역 · 미개봉 환불 · 처리 결과 확인'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: user == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const OrderHistoryPage(),
                          ),
                        ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.swap_horiz),
                  title: const Text('GP 전환 · 상품 복구'),
                  subtitle: const Text('전환 내역과 복구 가능 여부 확인'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: user == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ConversionPage(userId: user.id),
                          ),
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
                    MaterialPageRoute(
                      builder: (_) => const ShippingHistoryPage(),
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.support_agent),
                  title: const Text('소식·고객지원'),
                  subtitle: const Text('이벤트·공지·문의·교환 처리 현황'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          const CustomerUpdatesPage(initial: 'tickets'),
                    ),
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
                  onTap: user == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const AccountSecurityPage(),
                          ),
                        ),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('profile-email-verification'),
                  leading: const Icon(Icons.mark_email_read_outlined),
                  title: const Text('이메일 인증'),
                  subtitle: const Text('인증 메일 요청 · 이메일 소유 확인'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: user == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                const RecoveryPage(verifyEmail: true),
                          ),
                        ),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('profile-account-closure'),
                  leading: const Icon(Icons.person_off_outlined),
                  title: const Text('탈퇴 요청·상태'),
                  subtitle: const Text('잔여 거래 확인 · 요청 접수 및 취소'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: user == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const AccountClosurePage(),
                          ),
                        ),
                ),
              ],
            ),
          ),
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
