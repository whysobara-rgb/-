import 'package:flutter/material.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/agreements.dart';
import '../terms_page.dart';

/// 약관 동의 묶음: 전체 동의 + 항목별 체크, 필수/선택 표시, "보기" 링크.
///
/// 이메일 가입과 소셜 최초 가입 시트가 함께 쓴다.
class AgreementPanel extends StatelessWidget {
  final Agreements value;
  final ValueChanged<Agreements> onChanged;

  const AgreementPanel({
    super.key,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainer,
        borderRadius: Radii.card,
        border: Border.all(
          color: value.allRequired
              ? cs.primary.withValues(alpha: 0.35)
              : cs.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            checked: value.all,
            button: true,
            label: '전체 동의',
            excludeSemantics: true,
            child: InkWell(
              onTap: () => onChanged(value.toggleAll()),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(Radii.lg),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  Space.x4,
                  Space.x4,
                  Space.x4,
                  Space.x4,
                ),
                child: Row(
                  children: [
                    _CheckCircle(checked: value.all),
                    const SizedBox(width: Space.x3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('전체 동의', style: AppText.headline),
                          const SizedBox(height: 2),
                          Text(
                            '선택 항목(마케팅 정보 수신)까지 모두 동의해요',
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Divider(height: 1, color: cs.outlineVariant),
          const SizedBox(height: Space.x1),
          for (final item in AgreementItem.values)
            _AgreementRow(
              item: item,
              checked: value.valueOf(item),
              onTap: () => onChanged(value.set(item, !value.valueOf(item))),
            ),
          const SizedBox(height: Space.x1),
        ],
      ),
    );
  }
}

class _AgreementRow extends StatelessWidget {
  final AgreementItem item;
  final bool checked;
  final VoidCallback onTap;

  const _AgreementRow({
    required this.item,
    required this.checked,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final doc = item.document;
    return Row(
      children: [
        Expanded(
          child: Semantics(
            checked: checked,
            button: true,
            label: '${item.required ? '필수' : '선택'} ${item.label}',
            excludeSemantics: true,
            child: InkWell(
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(Space.x4, 10, Space.x2, 10),
                child: Row(
                  children: [
                    Icon(
                      Icons.check_rounded,
                      size: 20,
                      color: checked ? cs.primary : cs.outline,
                    ),
                    const SizedBox(width: Space.x3),
                    _RequiredTag(required: item.required),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        item.label,
                        style: AppText.body.copyWith(
                          color: checked ? cs.onSurface : cs.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (doc != null)
          Semantics(
            button: true,
            label: '${item.label} 보기',
            excludeSemantics: true,
            child: InkWell(
              onTap: () => Navigator.of(context).push(TermsPage.route(doc)),
              borderRadius: Radii.chip,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(Space.x2, 10, Space.x3, 10),
                child: Text(
                  '보기',
                  style: AppText.caption.copyWith(
                    decoration: TextDecoration.underline,
                    decorationColor: cs.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          )
        else
          const SizedBox(width: Space.x3),
      ],
    );
  }
}

class _RequiredTag extends StatelessWidget {
  final bool required;
  const _RequiredTag({required this.required});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      height: 18,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: required
            ? cs.primary.withValues(alpha: 0.1)
            : cs.onSurface.withValues(alpha: 0.06),
        borderRadius: Radii.chip,
      ),
      child: Text(
        required ? '필수' : '선택',
        style: AppText.micro.copyWith(
          color: required ? cs.primary : cs.onSurfaceVariant,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
    );
  }
}

/// 전체 동의용 원형 체크.
class _CheckCircle extends StatelessWidget {
  final bool checked;
  const _CheckCircle({required this.checked});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: Motion.fast,
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: checked ? cs.primary : Colors.transparent,
        border: Border.all(
          color: checked ? cs.primary : cs.outline,
          width: 1.5,
        ),
      ),
      child: checked
          ? Icon(Icons.check_rounded, size: 16, color: cs.onPrimary)
          : null,
    );
  }
}
