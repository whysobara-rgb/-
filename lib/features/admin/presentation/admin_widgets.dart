import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 운영자 화면 공용 조각. 촘촘하고 실용적으로, 앱 토큰만 쓴다.

/// 숫자 하나(지표 타일).
class KpiTile extends StatelessWidget {
  final String label;
  final String value;
  final String? note;
  final bool accent;
  final VoidCallback? onTap;

  const KpiTile({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.accent = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.button,
        side: BorderSide(
          color: accent
              ? AppColors.brand.withValues(alpha: 0.5)
              : AppColors.hairline,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.button,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                  ),
                  if (onTap != null)
                    const Icon(
                      Icons.chevron_right,
                      size: 16,
                      color: AppColors.textTertiary,
                    ),
                ],
              ),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: AppText.num(AppText.title2).copyWith(
                    color: accent ? AppColors.brand : AppColors.text,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (note != null)
                Text(
                  note!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.num(
                    AppText.micro,
                  ).copyWith(color: AppColors.textTertiary),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 가로 칩 필터.
class AdminFilterBar<T> extends StatelessWidget {
  final List<(String, T)> options;
  final T value;
  final ValueChanged<T> onChanged;

  const AdminFilterBar({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x3,
        Space.gutter,
        Space.x2,
      ),
      child: Row(
        children: [
          for (final (label, v) in options) ...[
            AdminChip(
              label: label,
              selected: v == value,
              onTap: () => onChanged(v),
            ),
            const SizedBox(width: 6),
          ],
        ],
      ),
    );
  }
}

class AdminChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const AdminChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.pill,
        child: Container(
          height: 30,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? AppColors.text : AppColors.surface,
            borderRadius: Radii.pill,
            border: Border.all(
              color: selected ? AppColors.text : AppColors.hairlineStrong,
            ),
          ),
          child: Text(
            label,
            style: AppText.num(AppText.caption).copyWith(
              color: selected ? AppColors.canvas : AppColors.text,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

/// 카드 안 인라인 오류 한 줄.
class InlineError extends StatelessWidget {
  final String message;
  const InlineError(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.08),
        borderRadius: Radii.chip,
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 16, color: AppColors.danger),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              message,
              style: AppText.caption.copyWith(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );
  }
}

/// 작은 상태 배지.
class StatusTag extends StatelessWidget {
  final String text;
  final Color color;
  const StatusTag(this.text, {super.key, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 19,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.chip,
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        text,
        style: AppText.micro.copyWith(
          color: color,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
    );
  }
}

/// 라벨: 값 (촘촘한 표 한 줄).
class KeyValue extends StatelessWidget {
  final String label;
  final String value;
  final bool mono;
  const KeyValue(this.label, this.value, {super.key, this.mono = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 64, child: Text(label, style: AppText.caption)),
          Expanded(
            child: Text(
              value,
              style: (mono ? AppText.num(AppText.caption) : AppText.caption)
                  .copyWith(color: AppColors.text),
            ),
          ),
        ],
      ),
    );
  }
}

/// 섹션 제목(대시보드).
class AdminSectionTitle extends StatelessWidget {
  final String text;
  final String? trailing;
  const AdminSectionTitle(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, Space.x5, 0, Space.x2),
      child: Row(
        children: [
          Expanded(child: Text(text, style: AppText.headline)),
          if (trailing != null)
            Text(trailing!, style: AppText.num(AppText.micro)),
        ],
      ),
    );
  }
}

/// 2~4열 타일 그리드(폭에 맞춰).
class TileGrid extends StatelessWidget {
  final List<Widget> children;
  const TileGrid({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final columns = c.maxWidth >= 720 ? 4 : (c.maxWidth >= 520 ? 3 : 2);
        const gap = Space.x2;
        final w = (c.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final child in children) SizedBox(width: w, child: child),
          ],
        );
      },
    );
  }
}
