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
import '../../inventory/data/inventory_repository.dart';
import '../../inventory/domain/inventory_item.dart';

/// 회원 탈퇴.
///
/// 1. 사라지는 것(보유 GP, 보관함 상품)을 실제 값으로 보여주고 확인 체크를 받는다.
/// 2. 한 번 더 묻는 시트에서 "탈퇴"를 눌러야 `DELETE /users/me`를 부른다.
/// 3. 배송 중이면(10013) 막고 이유를 보여준다. 끝나면 로그아웃한다.
class DeleteAccountPage extends StatefulWidget {
  /// 배송 내역 화면을 여는 콜백(10013일 때 안내 버튼).
  final VoidCallback? onOpenShipments;
  final InventoryRepository inventory;

  const DeleteAccountPage({
    super.key,
    this.onOpenShipments,
    this.inventory = const InventoryRepository(),
  });

  @override
  State<DeleteAccountPage> createState() => _DeleteAccountPageState();
}

class _DeleteAccountPageState extends State<DeleteAccountPage> {
  List<InventoryItem>? _stored;
  bool _confirmed = false;
  bool _deleting = false;
  int? _activeShipments;
  String? _error;
  int? _forfeitedGp;

  @override
  void initState() {
    super.initState();
    _loadInventory();
  }

  Future<void> _loadInventory() async {
    try {
      final items = await widget.inventory.list();
      if (!mounted) return;
      setState(() {
        // 배송 중·완료된 상품은 사라지지 않는다. 보관 중인 것만 센다.
        _stored = items
            .where((i) => i.status == InventoryStatus.stored)
            .toList();
      });
    } catch (_) {
      if (mounted) setState(() => _stored = const []);
    }
  }

  Future<void> _delete() async {
    final balance = context.read<GpProvider>().balance;
    final stored = _stored ?? const [];
    final ok = await showAppSheet<bool>(
      context: context,
      title: '정말 탈퇴할까요?',
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
              '${formatGp(balance)}와 보관 중인 상품 ${stored.length}개가 '
              '바로 사라지고 되돌릴 수 없어요.',
              style: AppText.body.copyWith(color: AppColors.text),
            ),
            const SizedBox(height: Space.x5),
            Row(
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
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.danger,
                    ),
                    child: const Text('탈퇴'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;

    setState(() {
      _deleting = true;
      _error = null;
      _activeShipments = null;
    });
    try {
      final forfeited = await context.read<AuthProvider>().deleteAccount();
      if (!mounted) return;
      setState(() => _forfeitedGp = forfeited);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.statusCode == ApiCode.activeShipments) {
          _activeShipments = e.errorInt('activeShipments') ?? 1;
        } else {
          _error = e.displayMessage;
        }
      });
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  Future<void> _finish() async {
    final navigator = Navigator.of(context);
    final tabs = context.read<TabNavigator>();
    final auth = context.read<AuthProvider>();
    navigator.popUntil((route) => route.isFirst);
    tabs.select(AppTab.home);
    await auth.logout();
  }

  @override
  Widget build(BuildContext context) {
    final forfeited = _forfeitedGp;
    return PopScope(
      canPop: forfeited == null,
      child: Scaffold(
        appBar: AppBar(
          titleSpacing: forfeited == null ? 0 : null,
          automaticallyImplyLeading: forfeited == null,
          title: const Text('회원 탈퇴'),
        ),
        body: SafeArea(
          child: forfeited != null
              ? _Done(forfeitedGp: forfeited, onConfirm: _finish)
              : _form(),
        ),
      ),
    );
  }

  Widget _form() {
    final user = context.watch<AuthProvider>().currentUser;
    final balance = context.watch<GpProvider>().balance;
    final stored = _stored;
    final storedValue = stored?.fold<int>(0, (s, i) => s + i.estimatedValue);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x2,
        Space.gutter,
        Space.x8,
      ),
      children: [
        Text('탈퇴하기 전에 확인해 주세요', style: AppText.title1),
        const SizedBox(height: Space.x1),
        Text(
          '${user?.nickname ?? ''} 님의 계정을 지우면 아래 항목이 함께 사라져요.',
          style: AppText.callout,
        ),
        const SizedBox(height: Space.x5),
        Container(
          padding: const EdgeInsets.all(Space.x4),
          decoration: BoxDecoration(
            color: AppColors.danger.withValues(alpha: 0.06),
            borderRadius: Radii.card,
            border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _LossRow(
                label: '보유 GP',
                value: formatGp(balance),
                note: '충전한 GP와 받은 GP 모두 소멸',
              ),
              const SizedBox(height: Space.x3),
              _LossRow(
                label: '보관함 상품',
                value: stored == null ? '확인 중' : '${stored.length}개',
                note: stored == null || stored.isEmpty
                    ? '보관 중인 상품이 없어요'
                    : '정가 합계 ${formatWon(storedValue!)} · 배송·전환 불가',
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.x5),
        const _Bullet('사라진 GP와 상품은 다시 가입해도 되돌릴 수 없어요.'),
        const _Bullet('환불이 필요한 결제가 있다면 탈퇴하기 전에 먼저 문의해 주세요.'),
        const _Bullet('배송이 진행 중인 신청이 있으면 배송이 끝난 뒤 탈퇴할 수 있어요.'),
        const _Bullet('결제·주문 기록은 관련 법에 따라 정해진 기간 동안 보관돼요.'),
        const _Bullet('이메일·닉네임 같은 계정 정보는 바로 지워지고, 이 계정으로 다시 로그인할 수 없어요.'),
        const SizedBox(height: Space.x5),
        if (_activeShipments != null) ...[
          _Blocked(
            count: _activeShipments!,
            onOpenShipments: widget.onOpenShipments,
          ),
          const SizedBox(height: Space.x4),
        ],
        if (_error != null) ...[
          Text(
            _error!,
            style: AppText.callout.copyWith(color: AppColors.danger),
          ),
          const SizedBox(height: Space.x4),
        ],
        Semantics(
          checked: _confirmed,
          button: true,
          label: '위 내용을 확인했어요',
          excludeSemantics: true,
          child: InkWell(
            onTap: () => setState(() => _confirmed = !_confirmed),
            borderRadius: Radii.button,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.x2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Checkbox(
                    value: _confirmed,
                    onChanged: (v) => setState(() => _confirmed = v ?? false),
                    visualDensity: VisualDensity.compact,
                  ),
                  const SizedBox(width: Space.x1),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Text(
                        keepAll(
                          '위 내용을 확인했고, ${formatGp(balance)}와 보관함 상품이 '
                          '사라지는 데 동의해요.',
                        ),
                        style: AppText.body.copyWith(color: AppColors.text),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: Space.x4),
        PrimaryButton(
          label: '탈퇴하기',
          loading: _deleting,
          color: AppColors.danger,
          onPressed: _confirmed && stored != null ? _delete : null,
        ),
      ],
    );
  }
}

class _LossRow extends StatelessWidget {
  final String label;
  final String value;
  final String note;
  const _LossRow({
    required this.label,
    required this.value,
    required this.note,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppText.bodyStrong),
              const SizedBox(height: 2),
              Text(note, style: AppText.caption),
            ],
          ),
        ),
        Text(
          value,
          style: AppText.num(AppText.title2).copyWith(color: AppColors.danger),
        ),
      ],
    );
  }
}

class _Bullet extends StatelessWidget {
  final String text;
  const _Bullet(this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.x2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8, right: 8),
          child: Container(
            width: 4,
            height: 4,
            decoration: const BoxDecoration(
              color: AppColors.textSecondary,
              shape: BoxShape.circle,
            ),
          ),
        ),
        Expanded(child: Text(keepAll(text), style: AppText.callout)),
      ],
    ),
  );
}

class _Blocked extends StatelessWidget {
  final int count;
  final VoidCallback? onOpenShipments;
  const _Blocked({required this.count, this.onOpenShipments});

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      borderColor: AppColors.hairlineStrong,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.local_shipping_outlined,
                size: 20,
                color: AppColors.text,
              ),
              const SizedBox(width: Space.x2),
              Expanded(
                child: Text(
                  '배송 중인 신청 $count건이 있어 지금은 탈퇴할 수 없어요',
                  style: AppText.bodyStrong,
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.x1),
          Text(
            keepAll('받는 분 정보가 배송을 마치는 데 필요해요. 배송이 끝나면 다시 시도해 주세요.'),
            style: AppText.caption,
          ),
          if (onOpenShipments != null) ...[
            const SizedBox(height: Space.x3),
            OutlinedButton(
              onPressed: onOpenShipments,
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
              child: const Text('배송 내역 보기'),
            ),
          ],
        ],
      ),
    );
  }
}

class _Done extends StatelessWidget {
  final int forfeitedGp;
  final VoidCallback onConfirm;
  const _Done({required this.forfeitedGp, required this.onConfirm});

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
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Spacer(),
          Center(
            child: Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.surface,
                border: Border.all(color: AppColors.hairlineStrong),
              ),
              child: const Icon(
                Icons.waving_hand_outlined,
                size: 30,
                color: AppColors.text,
              ),
            ),
          ),
          const SizedBox(height: Space.x5),
          Text('탈퇴했어요', style: AppText.title1, textAlign: TextAlign.center),
          const SizedBox(height: Space.x2),
          Text(
            forfeitedGp > 0
                ? '${formatGp(forfeitedGp)}가 소멸됐고, 계정 정보가 지워졌어요.\n그동안 이용해 주셔서 고마워요.'
                : '계정 정보가 지워졌어요.\n그동안 이용해 주셔서 고마워요.',
            style: AppText.callout,
            textAlign: TextAlign.center,
          ),
          const Spacer(),
          PrimaryButton(label: '확인', onPressed: onConfirm),
        ],
      ),
    );
  }
}
