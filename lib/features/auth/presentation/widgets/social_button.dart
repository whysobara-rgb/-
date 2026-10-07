import 'package:flutter/material.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../social/social_auth_client.dart';

/// 소셜 로그인 버튼. 크기·모서리는 앱 토큰을 따른다.
///
/// 카카오 노랑·네이버 초록·구글 G 파랑은 각 사 브랜드 가이드가 정한 고정색이라
/// 테마와 무관하게 그대로 쓴다. 구글·애플 버튼의 면과 글자는 지금 테마의
/// 색(밝은 바탕이면 흰 구글 버튼·검은 애플 버튼, 어두우면 반대)을 따른다.
class SocialButton extends StatelessWidget {
  final SocialProvider provider;
  final VoidCallback? onPressed;
  final bool loading;

  const SocialButton({
    super.key,
    required this.provider,
    required this.onPressed,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    final spec = _SocialSpec.of(provider, Theme.of(context).colorScheme);
    return Semantics(
      button: true,
      label: spec.label,
      excludeSemantics: true,
      child: Material(
        color: spec.background,
        shape: RoundedRectangleBorder(
          borderRadius: Radii.button,
          side: spec.border == null
              ? BorderSide.none
              : BorderSide(color: spec.border!),
        ),
        child: InkWell(
          onTap: loading ? null : onPressed,
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
                    child: Center(child: spec.symbol),
                  ),
                ),
                if (loading)
                  SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: spec.foreground,
                    ),
                  )
                else
                  Text(
                    spec.label,
                    style: AppText.headline.copyWith(
                      color: spec.foreground,
                      fontSize: 15,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SocialSpec {
  final String label;
  final Color background;
  final Color foreground;
  final Color? border;
  final Widget symbol;

  const _SocialSpec({
    required this.label,
    required this.background,
    required this.foreground,
    required this.symbol,
    this.border,
  });

  // 각 사 브랜드 가이드의 고정색.
  static const _kakaoYellow = Color(0xFFFEE500);
  static const _kakaoLabel = Color(0xD9000000);
  static const _kakaoSymbol = Color(0xFF000000);
  static const _naverGreen = Color(0xFF03C75A);
  static const _naverLabel = Color(0xFFFFFFFF);
  static const _googleBlue = Color(0xFF4285F4);

  static _SocialSpec of(SocialProvider p, ColorScheme cs) => switch (p) {
    SocialProvider.kakao => const _SocialSpec(
      label: '카카오로 시작하기',
      background: _kakaoYellow,
      foreground: _kakaoLabel,
      symbol: Icon(Icons.chat_bubble, size: 19, color: _kakaoSymbol),
    ),
    SocialProvider.naver => _SocialSpec(
      label: '네이버로 시작하기',
      background: _naverGreen,
      foreground: _naverLabel,
      symbol: Text(
        'N',
        style: AppText.headline.copyWith(
          color: _naverLabel,
          fontWeight: FontWeight.w900,
          fontSize: 17,
          height: 1,
        ),
      ),
    ),
    SocialProvider.google => _SocialSpec(
      label: 'Google로 시작하기',
      background: cs.surface,
      foreground: cs.onSurface,
      border: cs.outline,
      symbol: Text(
        'G',
        style: AppText.headline.copyWith(
          color: _googleBlue,
          fontWeight: FontWeight.w900,
          fontSize: 18,
          height: 1,
        ),
      ),
    ),
    SocialProvider.apple => _SocialSpec(
      label: 'Apple로 시작하기',
      background: cs.onSurface,
      foreground: cs.surface,
      symbol: SizedBox(
        width: 16,
        height: 19,
        child: CustomPaint(painter: AppleLogoPainter(color: cs.surface)),
      ),
    ),
  };
}
