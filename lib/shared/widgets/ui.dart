import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// 섹션 사이 8px 회색 띠. 카드 그림자 대신 이걸로 영역을 나눈다.
class SectionBand extends StatelessWidget {
  final double height;
  const SectionBand({super.key, this.height = Space.sectionGap});

  @override
  Widget build(BuildContext context) =>
      Container(height: height, color: AppColors.bgSubtle);
}

/// 1px 헤어라인. [inset]만큼 좌우를 띄운다.
class Hairline extends StatelessWidget {
  final double inset;
  const Hairline({super.key, this.inset = 0});

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.symmetric(horizontal: inset),
    child: const Divider(height: 1, thickness: 1, color: AppColors.line),
  );
}

/// 섹션 제목 + (선택) 우측 텍스트 액션.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.fromLTRB(
      Space.gutter,
      Space.x6,
      Space.gutter,
      Space.x3,
    ),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.title2),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: AppText.caption),
                ],
              ],
            ),
          ),
          if (actionLabel != null)
            InkWell(
              onTap: onAction,
              borderRadius: Radii.chip,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      actionLabel!,
                      style: AppText.caption.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      size: 16,
                      color: AppColors.inkSecondary,
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 라벨 — 값 한 줄. 표처럼 정렬되는 정보 블록에 쓴다.
class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final TextStyle? valueStyle;
  final Widget? trailing;
  final EdgeInsetsGeometry padding;

  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.valueStyle,
    this.trailing,
    this.padding = const EdgeInsets.symmetric(vertical: 7),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 96, child: Text(label, style: AppText.callout)),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: valueStyle ?? AppText.num(AppText.bodyStrong),
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 6), trailing!],
        ],
      ),
    );
  }
}

/// 메뉴 리스트 행(설정·MY 등).
class MenuRow extends StatelessWidget {
  final IconData? icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;
  final Color? labelColor;
  final bool showChevron;

  const MenuRow({
    super.key,
    this.icon,
    required this.label,
    this.value,
    this.onTap,
    this.labelColor,
    this.showChevron = true,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.gutter,
          vertical: 15,
        ),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 22, color: labelColor ?? AppColors.ink),
              const SizedBox(width: Space.x3),
            ],
            Expanded(
              child: Text(
                label,
                style: AppText.body.copyWith(
                  color: labelColor ?? AppColors.ink,
                ),
              ),
            ),
            if (value != null)
              Text(value!, style: AppText.num(AppText.callout)),
            if (showChevron) ...[
              const SizedBox(width: 2),
              const Icon(
                Icons.chevron_right,
                size: 20,
                color: AppColors.inkTertiary,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 로딩/오류/빈 상태.
class LoadingView extends StatelessWidget {
  final double height;
  const LoadingView({super.key, this.height = 200});

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: const Center(
      child: SizedBox(
        width: 22,
        height: 22,
        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.ink),
      ),
    ),
  );
}

class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  final double height;

  const ErrorView({
    super.key,
    required this.message,
    required this.onRetry,
    this.height = 240,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Center(
        child: Padding(
          padding: Space.page,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                message,
                textAlign: TextAlign.center,
                style: AppText.callout,
              ),
              const SizedBox(height: Space.x3),
              OutlinedButton(
                onPressed: onRetry,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 36),
                  textStyle: AppText.bodyStrong,
                ),
                child: const Text('다시 시도'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  final double height;

  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.action,
    this.height = 280,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Center(
        child: Padding(
          padding: Space.page,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 32, color: AppColors.inkTertiary),
              const SizedBox(height: Space.x3),
              Text(title, style: AppText.headline, textAlign: TextAlign.center),
              if (message != null) ...[
                const SizedBox(height: Space.x1),
                Text(
                  message!,
                  style: AppText.callout,
                  textAlign: TextAlign.center,
                ),
              ],
              if (action != null) ...[
                const SizedBox(height: Space.x4),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// 로딩 상태를 가진 꽉 찬 버튼.
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final bool expand;
  final Color? color;

  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.expand = true,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final button = FilledButton(
      onPressed: loading ? null : onPressed,
      style: color != null
          ? FilledButton.styleFrom(backgroundColor: color)
          : null,
      child: loading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.inkTertiary,
              ),
            )
          : Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// 바텀시트 공통 골격: 손잡이 + 제목 + 본문. 닫기 경로(바깥 탭, 닫기 버튼)를
/// 항상 열어둔다.
Future<T?> showAppSheet<T>({
  required BuildContext context,
  required String title,
  required WidgetBuilder builder,
  bool isScrollControlled = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    useSafeArea: true,
    builder: (sheetContext) {
      return Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: Space.x2),
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: const BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.all(Radius.circular(2)),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Space.gutter,
                  Space.x3,
                  Space.x2,
                  Space.x1,
                ),
                child: Row(
                  children: [
                    Expanded(child: Text(title, style: AppText.title2)),
                    IconButton(
                      tooltip: '닫기',
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      icon: const Icon(Icons.close, size: 22),
                    ),
                  ],
                ),
              ),
              Flexible(child: builder(sheetContext)),
            ],
          ),
        ),
      );
    },
  );
}

/// 스낵바 한 줄.
void showToast(BuildContext context, String message, {SnackBarAction? action}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        action: action,
        duration: const Duration(seconds: 3),
      ),
    );
}
