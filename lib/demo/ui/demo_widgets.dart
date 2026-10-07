import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/network/token_storage.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';
import '../../navigation/tab_navigator.dart';
import '../../shared/providers/auth_provider.dart';
import '../../shared/widgets/ui.dart';
import '../backend/demo_backend.dart';
import '../demo_config.dart';

/// 체험판 화면 조각들. 모두 `DemoConfig.enabled`로 감싼 자리에서만 쓴다.

const Color _amber = Color(0xFFFFC53D);

/// 한 줄 체험판 안내(노란 점 + 문구).
class DemoNote extends StatelessWidget {
  final String text;
  final EdgeInsetsGeometry padding;
  const DemoNote(this.text, {super.key, this.padding = EdgeInsets.zero});

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(Icons.science_outlined, size: 15, color: _amber),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              keepAll(text),
              style: AppText.caption.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// 로그인 화면: 체험 계정 안내와 "처음부터 다시".
class DemoLoginHint extends StatelessWidget {
  const DemoLoginHint({super.key});

  Future<void> _reset(BuildContext context) async {
    await DemoBackend.instance.reset();
    if (context.mounted) showToast(context, '체험판을 처음 상태로 되돌렸어요');
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: Space.x4),
      padding: const EdgeInsets.fromLTRB(Space.x3, 10, Space.x1, 10),
      decoration: BoxDecoration(
        color: _amber.withValues(alpha: 0.14),
        borderRadius: Radii.button,
        border: Border.all(color: _amber.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.science_outlined,
            size: 18,
            color: Color(0xFF8A6200),
          ),
          const SizedBox(width: Space.x2),
          Expanded(
            child: Text(
              keepAll(
                '체험 계정이 입력돼 있어요. 로그인하면 '
                '${formatGp(DemoConfig.defaultBalance)} 체험 GP로 시작해요.',
              ),
              style: AppText.caption.copyWith(color: cs.onSurface),
            ),
          ),
          TextButton(
            onPressed: () => _reset(context),
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 36),
              padding: const EdgeInsets.symmetric(horizontal: Space.x2),
            ),
            child: Text(
              '처음부터',
              style: AppText.caption.copyWith(
                color: cs.onSurface,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 배송 내역: 진행 중인 배송을 다음 단계로 넘겨 보는 버튼.
///
/// 실제로는 아무것도 발송되지 않는다. 송장은 "체험판 택배 / DEMO-…".
class DemoShippingSimButton extends StatefulWidget {
  final int shipmentId;
  final bool requested;
  final VoidCallback onChanged;

  const DemoShippingSimButton({
    super.key,
    required this.shipmentId,
    required this.requested,
    required this.onChanged,
  });

  @override
  State<DemoShippingSimButton> createState() => _DemoShippingSimButtonState();
}

class _DemoShippingSimButtonState extends State<DemoShippingSimButton> {
  bool _busy = false;

  Future<void> _advance() async {
    setState(() => _busy = true);
    try {
      final token = await const TokenStorage().readToken();
      final status = await DemoBackend.instance.simulateShippingStep(
        token,
        widget.shipmentId,
      );
      if (!mounted) return;
      showToast(
        context,
        status == 'DELIVERED' ? '체험 배송을 완료 처리했어요' : '체험판 택배로 발송 처리했어요',
      );
      widget.onChanged();
    } on DemoActionException catch (e) {
      if (mounted) showToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: Space.x2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton.icon(
            onPressed: _busy ? null : _advance,
            icon: const Icon(Icons.fast_forward_rounded, size: 18),
            label: Text(
              widget.requested ? '배송 진행 시뮬레이션 · 발송 처리' : '배송 진행 시뮬레이션 · 배송 완료',
            ),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 44),
              side: BorderSide(color: _amber.withValues(alpha: 0.7)),
            ),
          ),
          const DemoNote(
            '체험판이라 실제로 발송되지 않아요. 단계와 송장 표시만 미리 볼 수 있어요.',
            padding: EdgeInsets.only(top: 6),
          ),
        ],
      ),
    );
  }
}

/// MY: 운영자 모드 체험 스위치와 체험판 초기화.
class DemoProfileSection extends StatefulWidget {
  const DemoProfileSection({super.key});

  @override
  State<DemoProfileSection> createState() => _DemoProfileSectionState();
}

class _DemoProfileSectionState extends State<DemoProfileSection> {
  bool _busy = false;

  Future<void> _setAdmin(bool value) async {
    if (_busy) return;
    setState(() => _busy = true);
    final auth = context.read<AuthProvider>();
    try {
      final token = await const TokenStorage().readToken();
      await DemoBackend.instance.setAdmin(token, value);
      await auth.refreshProfile();
      if (mounted) {
        showToast(
          context,
          value ? '운영자 모드를 켰어요. 아래 "운영자 모드"에서 들어가요' : '운영자 모드를 껐어요',
        );
      }
    } on DemoActionException catch (e) {
      if (mounted) showToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final ok = await showAppSheet<bool>(
      context: context,
      title: '체험판을 초기화할까요?',
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
              keepAll(
                '이 기기에 저장된 체험 기록(보관함, GP 내역, 결제·배송, 출석)을 모두 '
                '지우고 체험 계정을 ${formatGp(DemoConfig.defaultBalance)}으로 다시 시작해요. '
                '로그인 화면으로 돌아가요.',
              ),
              style: AppText.body,
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
                    child: const Text('초기화'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final tabs = context.read<TabNavigator>();
    final auth = context.read<AuthProvider>();
    await DemoBackend.instance.reset();
    tabs.select(AppTab.home);
    await auth.logout();
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = context.select<AuthProvider, bool>(
      (a) => a.currentUser?.isAdmin ?? false,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x5,
            Space.gutter,
            Space.x1,
          ),
          child: Row(
            children: [
              const Icon(Icons.science_outlined, size: 14, color: _amber),
              const SizedBox(width: 4),
              Text(
                '체험판',
                style: AppText.caption.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
        // 목록의 한 칸 안에 여러 행이 있어, 행마다 시맨틱 노드를 따로 만든다.
        Semantics(
          container: true,
          toggled: isAdmin,
          button: true,
          label: '운영자 모드 체험',
          excludeSemantics: true,
          child: InkWell(
            onTap: _busy ? null : () => _setAdmin(!isAdmin),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                10,
                Space.x3,
                10,
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.admin_panel_settings_outlined,
                    size: 21,
                    color: AppColors.text.withValues(alpha: 0.85),
                  ),
                  const SizedBox(width: Space.x3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('운영자 모드 체험', style: AppText.body),
                        Text(
                          '이 기기의 체험 데이터로 운영 화면을 써 봐요',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: isAdmin,
                    onChanged: _busy ? null : _setAdmin,
                    activeTrackColor: AppColors.brand,
                    activeThumbColor: AppColors.onBrand,
                  ),
                ],
              ),
            ),
          ),
        ),
        Semantics(
          container: true,
          child: MenuRow(
            icon: Icons.restart_alt,
            label: '체험판 초기화',
            value: '처음 상태로',
            onTap: _reset,
          ),
        ),
        const SectionBand(),
      ],
    );
  }
}
