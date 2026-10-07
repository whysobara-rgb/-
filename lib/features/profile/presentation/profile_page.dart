import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/ui.dart';
import '../../gacha/presentation/odds_index_page.dart';
import '../../inventory/data/inventory_repository.dart';
import '../../inventory/domain/inventory_item.dart';
import '../../wallet/data/wallet_repository.dart';
import '../../wallet/domain/topup_limit.dart';
import '../../wallet/presentation/point_history_page.dart';
import '../../wallet/presentation/widgets/limit_sheet.dart';

/// MY 탭.
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  static const _inventory = InventoryRepository();
  static const _wallet = WalletRepository();
  static const _api = ApiClient();

  int? _drawCount;
  int? _storedCount;
  int? _deliveredCount;
  TopupLimit? _limit;
  int _seenRevision = -1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await Future.wait([_loadInventory(), _loadDraws(), _loadLimit()]);
  }

  Future<void> _loadInventory() async {
    try {
      final items = await _inventory.list();
      if (!mounted) return;
      setState(() {
        _storedCount = items
            .where((i) => i.status == InventoryStatus.stored)
            .length;
        _deliveredCount = items
            .where((i) => i.status == InventoryStatus.delivered)
            .length;
      });
    } catch (_) {}
  }

  Future<void> _loadDraws() async {
    try {
      final data = asMap(await _api.get('/draws/stats'));
      if (mounted) setState(() => _drawCount = asInt(data['totalDrawCount']));
    } catch (_) {}
  }

  Future<void> _loadLimit() async {
    try {
      final limit = await _wallet.limit();
      if (mounted) setState(() => _limit = limit);
    } catch (_) {}
  }

  Future<void> _editLimit() async {
    final current = _limit;
    if (current == null) return;
    final updated = await showLimitSheet(context, current);
    if (updated == null || !mounted) return;
    setState(() => _limit = updated);
    showToast(context, updated.savedMessage);
  }

  Future<void> _logout() async {
    final ok = await showAppSheet<bool>(
      context: context,
      title: '로그아웃할까요?',
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          Space.x2,
          Space.gutter,
          Space.x4,
        ),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.of(sheet).pop(false),
                child: const Text('취소'),
              ),
            ),
            const SizedBox(width: Space.x2),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.of(sheet).pop(true),
                style: FilledButton.styleFrom(backgroundColor: AppColors.ink),
                child: const Text('로그아웃'),
              ),
            ),
          ],
        ),
      ),
    );
    if (ok == true && mounted) {
      context.read<TabNavigator>().select(AppTab.home);
      await context.read<AuthProvider>().logout();
    }
  }

  String get _limitLabel {
    final l = _limit;
    if (l == null) return '';
    return l.hasLimit ? formatWon(l.monthlyLimit!) : '설정 안 함';
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;
    final balance = context.watch<GpProvider>().balance;
    final tabs = context.read<TabNavigator>();
    final revision = context.select<TabNavigator, int>(
      (t) => t.revisionOf(AppTab.my),
    );
    if (revision != _seenRevision) {
      final first = _seenRevision == -1;
      _seenRevision = revision;
      if (!first) WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }

    return Scaffold(
      appBar: AppBar(title: const Text('MY')),
      body: RefreshIndicator(
        color: AppColors.ink,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: Space.x10),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                Space.x2,
                Space.gutter,
                Space.x5,
              ),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: AppColors.bgSubtle,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      (user?.nickname.isNotEmpty ?? false)
                          ? user!.nickname.characters.first
                          : '·',
                      style: AppText.title2.copyWith(
                        color: AppColors.inkSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.x3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.nickname ?? '', style: AppText.title2),
                        const SizedBox(height: 2),
                        Text(user?.maskedEmail ?? '', style: AppText.caption),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // 보유 GP.
            Padding(
              padding: Space.page,
              child: InkWell(
                onTap: () => tabs.select(AppTab.wallet),
                borderRadius: Radii.card,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(
                    Space.x4,
                    Space.x4,
                    Space.x3,
                    Space.x4,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.line),
                    borderRadius: Radii.card,
                  ),
                  child: Row(
                    children: [
                      Text('보유 GP', style: AppText.callout),
                      const Spacer(),
                      Text(
                        formatGp(balance),
                        style: AppText.num(
                          AppText.headline,
                        ).copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(width: 2),
                      const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: AppColors.inkTertiary,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: Space.x3),

            // 활동 요약.
            Padding(
              padding: Space.page,
              child: IntrinsicHeight(
                child: Row(
                  children: [
                    _Stat(label: '뽑기', value: _drawCount, unit: '회'),
                    const VerticalDivider(width: 1, color: AppColors.line),
                    _Stat(
                      label: '보관 중',
                      value: _storedCount,
                      unit: '개',
                      onTap: () => tabs.select(AppTab.inventory),
                    ),
                    const VerticalDivider(width: 1, color: AppColors.line),
                    _Stat(label: '배송 완료', value: _deliveredCount, unit: '개'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: Space.x5),
            const SectionBand(),

            const _GroupTitle('내 활동'),
            MenuRow(
              icon: Icons.receipt_long_outlined,
              label: 'GP 내역',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const PointHistoryPage(),
                ),
              ),
            ),
            MenuRow(
              icon: Icons.inventory_2_outlined,
              label: '보관함',
              onTap: () => tabs.select(AppTab.inventory),
            ),
            const SectionBand(),

            const _GroupTitle('안전한 이용'),
            MenuRow(
              icon: Icons.speed_outlined,
              label: '월 충전 한도',
              value: _limitLabel,
              onTap: _editLimit,
            ),
            MenuRow(
              icon: Icons.percent,
              label: '확률 및 구성 정보',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const OddsIndexPage()),
              ),
            ),
            const SectionBand(),

            MenuRow(
              icon: Icons.logout,
              label: '로그아웃',
              labelColor: AppColors.inkSecondary,
              showChevron: false,
              onTap: _logout,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                Space.x3,
                Space.gutter,
                0,
              ),
              child: Text(
                '가치가차 1.0.0',
                style: AppText.caption.copyWith(color: AppColors.inkTertiary),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupTitle extends StatelessWidget {
  final String text;
  const _GroupTitle(this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      Space.gutter,
      Space.x5,
      Space.gutter,
      Space.x1,
    ),
    child: Text(
      text,
      style: AppText.caption.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

class _Stat extends StatelessWidget {
  final String label;
  final int? value;
  final String unit;
  final VoidCallback? onTap;

  const _Stat({
    required this.label,
    required this.value,
    required this.unit,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Space.x2),
          child: Column(
            children: [
              Text(
                value == null ? '-' : '${formatNumber(value!)}$unit',
                style: AppText.num(
                  AppText.headline,
                ).copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 2),
              Text(label, style: AppText.caption),
            ],
          ),
        ),
      ),
    );
  }
}
