import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';

/// 공통 UI 조각(밝은 테마 한 벌).
///
/// 색은 토큰([AppColors])만 쓰고, 화면마다 카드·칩·섹션 제목을 새로 만들지
/// 않도록 여기 모아 둔다. 2차의 위젯 이름과 생성자는 그대로 남겨서
/// 다른 화면이 고치지 않아도 새 스타일을 받는다.

/// 섹션 사이 띠: 옅은 회색 면. 화면을 '묶음'으로 나누는 리듬.
class SectionBand extends StatelessWidget {
  final double height;
  const SectionBand({super.key, this.height = 8});

  @override
  Widget build(BuildContext context) =>
      Container(height: height, color: AppColors.section);
}

/// 1px 헤어라인. [inset]만큼 좌우를 띄운다.
class Hairline extends StatelessWidget {
  final double inset;
  const Hairline({super.key, this.inset = 0});

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.symmetric(horizontal: inset),
    child: const Divider(height: 1, thickness: 1, color: AppColors.hairline),
  );
}

/// 섹션 제목(20/800) + (선택) 작은 라벨·부제 + 우측 "전체보기 >".
class SectionHeader extends StatelessWidget {
  final String title;

  /// 제목 위 작은 라벨(브랜드 색). 한 화면에 한두 번만.
  final String? eyebrow;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Widget? trailing;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.eyebrow,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    this.trailing,
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
                if (eyebrow != null) ...[
                  Text(eyebrow!, style: AppText.eyebrow),
                  const SizedBox(height: Space.x1),
                ],
                Text(title, style: AppText.section),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: AppText.caption),
                ],
              ],
            ),
          ),
          ?trailing,
          if (actionLabel != null)
            InkWell(
              onTap: onAction,
              borderRadius: Radii.chip,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(6, 4, 0, 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      actionLabel!,
                      style: AppText.callout.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      size: 18,
                      color: AppColors.textSecondary,
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
    this.padding = const EdgeInsets.symmetric(vertical: 8),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 104, child: Text(label, style: AppText.callout)),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style:
                  valueStyle ??
                  AppText.num(
                    AppText.bodyStrong,
                  ).copyWith(color: AppColors.text),
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
    final fg = labelColor ?? AppColors.text;
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
              Icon(icon, size: 21, color: fg.withValues(alpha: 0.85)),
              const SizedBox(width: Space.x3),
            ],
            Expanded(
              child: Text(
                label,
                style: AppText.body.copyWith(
                  color: fg,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            if (value != null)
              Text(value!, style: AppText.num(AppText.callout)),
            if (showChevron) ...[
              const SizedBox(width: 2),
              const Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: AppColors.textTertiary,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 채움 카드: 캔버스와 한 단 다른 옅은 면 + 헤어라인.
/// 흰 카드에 그림자가 필요하면 [AppCard].
class SurfaceCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final BorderRadius borderRadius;
  final Color color;
  final Color? borderColor;

  const SurfaceCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.x4),
    this.borderRadius = Radii.card,
    this.color = AppColors.surface,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: borderRadius,
        border: Border.all(color: borderColor ?? AppColors.hairline),
      ),
      child: child,
    );
  }
}

/// 떠 있는 흰 카드: 헤어라인 + 여러 겹의 옅은 그림자. [onTap]이 있으면
/// 누를 수 있다.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final BorderRadius borderRadius;
  final Color color;
  final Color? borderColor;
  final List<BoxShadow> shadow;
  final VoidCallback? onTap;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.x4),
    this.borderRadius = Radii.card,
    this.color = AppColors.raised,
    this.borderColor,
    this.shadow = Shadows.card,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final content = Padding(padding: padding, child: child);
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: borderRadius, boxShadow: shadow),
      child: Material(
        color: color,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: borderRadius,
          side: BorderSide(color: borderColor ?? AppColors.hairline),
        ),
        child: onTap == null ? content : InkWell(onTap: onTap, child: content),
      ),
    );
  }
}

/// 큰 숫자 + 작은 단위("49,000 GP", "1,700,000원"). 가격·잔액 표기용.
class PriceText extends StatelessWidget {
  final num amount;
  final String unit;
  final double size;
  final Color? color;
  final Color? unitColor;
  final FontWeight weight;

  const PriceText(
    this.amount, {
    super.key,
    this.unit = 'GP',
    this.size = 18,
    this.color,
    this.unitColor,
    this.weight = FontWeight.w800,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.text;
    final won = unit == '원';
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: formatNumber(amount)),
          TextSpan(
            text: won ? unit : ' $unit',
            style: TextStyle(
              fontSize: size * (won ? 0.72 : 0.6),
              fontWeight: FontWeight.w700,
              letterSpacing: 0,
              color: unitColor ?? (won ? c : c.withValues(alpha: 0.6)),
            ),
          ),
        ],
      ),
      maxLines: 1,
      style: AppText.price.copyWith(
        fontSize: size,
        fontWeight: weight,
        letterSpacing: -size * 0.035,
        color: c,
        height: 1.1,
      ),
    );
  }
}

/// 둥근 흰 아이콘 버튼(상세 헤더처럼 그림 위에 뜨는 뒤로가기 등).
class CircleIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final double size;

  const CircleIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    final button = DecoratedBox(
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: Shadows.small,
      ),
      child: Material(
        color: AppColors.raised.withValues(alpha: 0.94),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(icon, size: size * 0.55, color: AppColors.text),
          ),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip, child: button);
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
        child: CircularProgressIndicator(
          strokeWidth: 2.4,
          color: AppColors.brand,
        ),
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
                  minimumSize: const Size(0, 40),
                  textStyle: AppText.bodyStrong,
                  shape: const StadiumBorder(),
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
              Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.all(Radius.circular(20)),
                ),
                child: Icon(icon, size: 28, color: AppColors.textTertiary),
              ),
              const SizedBox(height: Space.x4),
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

/// 로딩 상태를 가진 꽉 찬 버튼(브랜드 레드).
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
                color: AppColors.textSecondary,
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
                    color: AppColors.hairlineStrong,
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
                    Expanded(
                      child: Text(
                        title,
                        style: AppText.title2.copyWith(color: AppColors.text),
                      ),
                    ),
                    IconButton(
                      tooltip: '닫기',
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      icon: const Icon(Icons.close_rounded, size: 22),
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

/// 시트 안의 정보 묶음 바탕(옅은 회색 면).
class SheetPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  const SheetPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(
      horizontal: Space.x4,
      vertical: Space.x2,
    ),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.card,
      ),
      child: child,
    );
  }
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

/// 필터·정렬 칩. 선택되면 잉크 면 + 흰 글씨, 아니면 흰 면 + 헤어라인.
class AppChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  /// 라벨 앞 작은 그림(패키지 썸네일 등).
  final Widget? leading;

  const AppChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.leading,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.text : AppColors.raised,
      shape: StadiumBorder(
        side: BorderSide(
          color: selected ? AppColors.text : AppColors.hairlineStrong,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 34,
          padding: EdgeInsets.only(left: leading == null ? 14 : 5, right: 14),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (leading != null) ...[leading!, const SizedBox(width: 6)],
              Text(
                label,
                style: AppText.num(AppText.callout).copyWith(
                  color: selected ? Colors.white : AppColors.text,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                  height: 1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Deprecated: [AppChip]과 같다(2차 이름).
class VaultChip extends AppChip {
  const VaultChip({
    super.key,
    required super.label,
    required super.selected,
    required super.onTap,
  });
}
