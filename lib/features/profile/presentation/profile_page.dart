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
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/ui.dart';
import '../../auth/domain/agreements.dart';
import '../../auth/presentation/terms_page.dart';
import '../../auth/social/social_auth_client.dart';
import '../../gacha/presentation/odds_index_page.dart';
import '../../inventory/data/inventory_repository.dart';
import '../../inventory/domain/inventory_item.dart';
import '../../wallet/data/wallet_repository.dart';
import '../../wallet/domain/topup_limit.dart';
import '../../wallet/presentation/payment_history_page.dart';
import '../../wallet/presentation/point_history_page.dart';
import '../../wallet/presentation/widgets/limit_sheet.dart';
import 'delete_account_page.dart';

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
  bool _savingMarketing = false;

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
                style: FilledButton.styleFrom(backgroundColor: AppColors.text),
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

  Future<void> _editNickname(String current) async {
    final saved = await showAppSheet<bool>(
      context: context,
      title: '닉네임 변경',
      builder: (_) => _NicknameSheet(initial: current),
    );
    if (saved == true && mounted) showToast(context, '닉네임을 바꿨어요');
  }

  Future<void> _setMarketing(bool value) async {
    if (_savingMarketing) return;
    setState(() => _savingMarketing = true);
    try {
      await context.read<AuthProvider>().updateProfile(agreeMarketing: value);
      if (!mounted) return;
      // 수신 동의·거부 결과는 날짜와 함께 알린다.
      final now = DateTime.now();
      final date =
          '${now.year}.${now.month.toString().padLeft(2, '0')}.'
          '${now.day.toString().padLeft(2, '0')}';
      showToast(
        context,
        value ? '$date 마케팅 정보 수신에 동의했어요' : '$date 마케팅 정보 수신을 거부했어요',
      );
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _savingMarketing = false);
    }
  }

  void _openDeleteAccount() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => const DeleteAccountPage()));
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
        color: AppColors.text,
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
                    width: 58,
                    height: 58,
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: SweepGradient(
                        colors: [
                          AppColors.brand,
                          Color.lerp(AppColors.brand, AppColors.text, 0.4)!,
                          AppColors.brandPressed,
                          AppColors.brand,
                        ],
                      ),
                    ),
                    child: Container(
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: AppColors.raised,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        (user?.nickname.isNotEmpty ?? false)
                            ? user!.nickname.characters.first
                            : '·',
                        style: AppText.title1.copyWith(
                          color: AppColors.text,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.x3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                user?.nickname ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.title2,
                              ),
                            ),
                            IconButton(
                              tooltip: '닉네임 변경',
                              visualDensity: VisualDensity.compact,
                              onPressed: user == null
                                  ? null
                                  : () => _editNickname(user.nickname),
                              icon: const Icon(
                                Icons.edit_outlined,
                                size: 18,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          [
                            '${signInMethodLabel(user?.provider)} 로그인',
                            if ((user?.maskedEmail ?? '').isNotEmpty)
                              user!.maskedEmail,
                          ].join(' · '),
                          style: AppText.caption,
                        ),
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
                    color: AppColors.surface,
                    border: Border.all(color: AppColors.hairline),
                    borderRadius: Radii.card,
                    gradient: LinearGradient(
                      colors: [
                        AppColors.brand.withValues(alpha: 0.10),
                        AppColors.surface,
                      ],
                      stops: const [0, 0.6],
                    ),
                  ),
                  child: Row(
                    children: [
                      const GpCoin(size: 20),
                      const SizedBox(width: 8),
                      Text('보유 GP', style: AppText.callout),
                      const Spacer(),
                      Text(
                        formatGp(balance),
                        style: AppText.num(
                          AppText.title2,
                        ).copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(width: 2),
                      const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: AppColors.textTertiary,
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
              child: SurfaceCard(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: IntrinsicHeight(
                  child: Row(
                    children: [
                      _Stat(label: '뽑기', value: _drawCount, unit: '회'),
                      const VerticalDivider(
                        width: 1,
                        color: AppColors.hairline,
                      ),
                      _Stat(
                        label: '보관 중',
                        value: _storedCount,
                        unit: '개',
                        onTap: () => tabs.select(AppTab.inventory),
                      ),
                      const VerticalDivider(
                        width: 1,
                        color: AppColors.hairline,
                      ),
                      _Stat(label: '배송 완료', value: _deliveredCount, unit: '개'),
                    ],
                  ),
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
              icon: Icons.credit_card_outlined,
              label: '결제 내역',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const PaymentHistoryPage(),
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

            const _GroupTitle('알림·약관'),
            _SwitchRow(
              icon: Icons.campaign_outlined,
              label: '마케팅 정보 수신',
              subtitle: '이벤트·혜택 소식을 받아요',
              value: user?.marketingAgreed ?? false,
              busy: _savingMarketing,
              onChanged: user == null ? null : _setMarketing,
            ),
            MenuRow(
              icon: Icons.description_outlined,
              label: '이용약관',
              onTap: () => Navigator.of(
                context,
              ).push(TermsPage.route(TermsDocument.terms)),
            ),
            MenuRow(
              icon: Icons.privacy_tip_outlined,
              label: '개인정보처리방침',
              onTap: () => Navigator.of(
                context,
              ).push(TermsPage.route(TermsDocument.privacyPolicy)),
            ),
            const SectionBand(),

            MenuRow(
              icon: Icons.logout,
              label: '로그아웃',
              labelColor: AppColors.textSecondary,
              showChevron: false,
              onTap: _logout,
            ),
            MenuRow(
              icon: Icons.person_remove_outlined,
              label: '회원 탈퇴',
              labelColor: AppColors.textTertiary,
              onTap: _openDeleteAccount,
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
                style: AppText.caption.copyWith(color: AppColors.textTertiary),
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

/// 스위치 한 줄(설정).
class _SwitchRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final bool value;
  final bool busy;
  final ValueChanged<bool>? onChanged;

  const _SwitchRow({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.value,
    required this.busy,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: value,
      label: label,
      button: true,
      excludeSemantics: true,
      child: InkWell(
        onTap: busy || onChanged == null ? null : () => onChanged!(!value),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Space.gutter, 10, Space.x3, 10),
          child: Row(
            children: [
              Icon(
                icon,
                size: 21,
                color: AppColors.text.withValues(alpha: 0.85),
              ),
              const SizedBox(width: Space.x3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppText.body),
                    Text(subtitle, style: AppText.caption),
                  ],
                ),
              ),
              Switch(
                value: value,
                onChanged: busy ? null : onChanged,
                activeTrackColor: AppColors.brand,
                activeThumbColor: AppColors.onBrand,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 닉네임 변경 시트. 저장하면 true로 닫힌다.
class _NicknameSheet extends StatefulWidget {
  final String initial;
  const _NicknameSheet({required this.initial});

  @override
  State<_NicknameSheet> createState() => _NicknameSheetState();
}

class _NicknameSheetState extends State<_NicknameSheet> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initial,
  );
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = _controller.text.trim();
    if (value.length < 2 || value.length > 20) {
      setState(() => _error = '닉네임은 2~20자로 정해 주세요');
      return;
    }
    if (value == widget.initial) {
      Navigator.of(context).pop(false);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().updateProfile(nickname: value);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.displayMessage;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
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
          TextField(
            controller: _controller,
            autofocus: true,
            maxLength: 20,
            style: AppText.body,
            onSubmitted: (_) => _save(),
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
            decoration: InputDecoration(hintText: '2~20자', errorText: _error),
          ),
          const SizedBox(height: Space.x3),
          PrimaryButton(label: '저장', loading: _saving, onPressed: _save),
        ],
      ),
    );
  }
}
