import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';

/// 소셜 로그인 버튼. 각 사 브랜드 색은 사 가이드를 따르고,
/// 크기·모서리·글자는 앱 토큰을 따른다.
class SocialLoginButton extends StatelessWidget {
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;
  final Widget icon;
  final Color? borderColor;
  final VoidCallback onTap;
  final bool isLoading;
  final bool disabled;

  const SocialLoginButton({
    super.key,
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
    required this.icon,
    required this.onTap,
    this.borderColor,
    this.isLoading = false,
    this.disabled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: backgroundColor,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.button,
        side: borderColor != null
            ? BorderSide(color: borderColor!)
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: disabled ? null : onTap,
        borderRadius: Radii.button,
        child: SizedBox(
          height: 52,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Positioned(
                left: Space.x4,
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: Center(child: icon),
                ),
              ),
              isLoading
                  ? SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: foregroundColor,
                      ),
                    )
                  : Text(
                      label,
                      style: AppText.headline.copyWith(color: foregroundColor),
                    ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 원형 소셜 버튼(보조 로그인 수단).
class SocialCircleButton extends StatelessWidget {
  final String tooltip;
  final Color backgroundColor;
  final Widget icon;
  final bool outlined;
  final VoidCallback? onTap;
  final bool isLoading;

  const SocialCircleButton({
    super.key,
    required this.tooltip,
    required this.backgroundColor,
    required this.icon,
    required this.onTap,
    this.outlined = false,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: backgroundColor,
        shape: CircleBorder(
          side: outlined
              ? const BorderSide(color: AppColors.line)
              : BorderSide.none,
        ),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Center(
              child: isLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : icon,
            ),
          ),
        ),
      ),
    );
  }
}
