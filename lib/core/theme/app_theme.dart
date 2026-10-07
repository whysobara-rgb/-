import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// 가치가차 테마 — 로그인부터 뽑기 결과까지 앱 전체가 한 벌의 밝은 테마.
///
/// 흰 캔버스 + 잉크 글자 + 캡슐 레드 CTA. 위계는 표면 밝기 대신
/// 굵기·크기와 여러 겹의 옅은 그림자([Shadows])로 만든다.
/// 뽑기 연출 화면만 등급 색면 위에서 흰 글자를 쓴다(그 화면이 직접 정한다).
///
/// 컬러/타입/간격 토큰은 [AppColors], [AppText], [Space]/[Radii]/[Shadows]/
/// [Motion]에서만 정의한다.
class AppTheme {
  AppTheme._();

  /// 앱 전체 테마.
  static ThemeData get light => _build();

  /// Deprecated: 3차부터 테마는 한 벌이다. [light]와 같다.
  static ThemeData get vault => light;

  /// Deprecated: 3차부터 테마는 한 벌이다. [light]와 같다.
  static ThemeData get paper => light;

  static ThemeData _build() {
    const bg = AppColors.canvas;
    const text = AppColors.text;
    final base = ThemeData(
      brightness: Brightness.light,
      useMaterial3: true,
      fontFamily: AppText.family,
      splashFactory: InkRipple.splashFactory,
    );

    final scheme =
        ColorScheme.fromSeed(
          seedColor: AppColors.brand,
          brightness: Brightness.light,
        ).copyWith(
          primary: AppColors.brand,
          onPrimary: AppColors.onBrand,
          primaryContainer: AppColors.brandSoft,
          onPrimaryContainer: AppColors.brandDeep,
          secondary: text,
          onSecondary: Colors.white,
          surface: bg,
          onSurface: text,
          onSurfaceVariant: AppColors.textSecondary,
          surfaceContainerLowest: bg,
          surfaceContainerLow: AppColors.section,
          surfaceContainer: AppColors.surface,
          surfaceContainerHigh: AppColors.surface,
          surfaceContainerHighest: AppColors.high,
          outline: AppColors.hairlineStrong,
          outlineVariant: AppColors.hairline,
          error: AppColors.danger,
          onError: Colors.white,
          surfaceTint: Colors.transparent,
          inverseSurface: text,
          onInverseSurface: Colors.white,
          shadow: const Color(0xFF101828),
        );

    TextStyle c(TextStyle s, [Color color = text]) => s.copyWith(color: color);

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      dividerColor: AppColors.hairline,
      splashColor: text.withValues(alpha: 0.05),
      highlightColor: text.withValues(alpha: 0.03),

      textTheme: base.textTheme
          .copyWith(
            displaySmall: AppText.hero,
            headlineMedium: AppText.display,
            titleLarge: AppText.title1,
            titleMedium: AppText.headline,
            titleSmall: AppText.bodyStrong,
            bodyLarge: AppText.body,
            bodyMedium: AppText.body,
            bodySmall: AppText.caption,
            labelLarge: AppText.bodyStrong,
            labelMedium: AppText.caption,
            labelSmall: AppText.micro,
          )
          .apply(bodyColor: text, displayColor: text),

      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: text,
        elevation: 0,
        // 내용이 앱바 밑으로 지나가면 아주 옅은 그림자 한 줄로 경계를 만든다.
        scrolledUnderElevation: 1,
        shadowColor: const Color(0x29101828),
        centerTitle: false,
        titleSpacing: Space.gutter,
        surfaceTintColor: Colors.transparent,
        toolbarHeight: 52,
        titleTextStyle: c(AppText.title2),
        iconTheme: const IconThemeData(color: text, size: 24),
        actionsIconTheme: const IconThemeData(color: text, size: 24),
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),

      iconTheme: const IconThemeData(color: text, size: 24),

      dividerTheme: const DividerThemeData(
        color: AppColors.hairline,
        thickness: 1,
        space: 1,
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: AppColors.onBrand,
          disabledBackgroundColor: AppColors.high,
          disabledForegroundColor: AppColors.textTertiary,
          minimumSize: const Size(0, 54),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline.copyWith(fontWeight: FontWeight.w800),
          elevation: 0,
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: AppColors.onBrand,
          elevation: 0,
          minimumSize: const Size(0, 54),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline.copyWith(fontWeight: FontWeight.w800),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: text,
          backgroundColor: AppColors.raised,
          disabledForegroundColor: AppColors.textTertiary,
          minimumSize: const Size(0, 54),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          side: const BorderSide(color: AppColors.hairlineStrong),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: text,
          textStyle: AppText.bodyStrong,
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Space.x4,
          vertical: 15,
        ),
        hintStyle: AppText.body.copyWith(color: AppColors.textTertiary),
        labelStyle: c(AppText.caption, AppColors.textSecondary),
        floatingLabelStyle: c(AppText.caption),
        suffixStyle: c(AppText.body, AppColors.textSecondary),
        border: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: Colors.transparent),
        ),
        enabledBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: Colors.transparent),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: text, width: 1.4),
        ),
        errorBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: AppColors.danger),
        ),
      ),

      textSelectionTheme: TextSelectionThemeData(
        cursorColor: AppColors.brand,
        selectionHandleColor: AppColors.brand,
        selectionColor: AppColors.brand.withValues(alpha: 0.22),
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? AppColors.brand
              : Colors.transparent,
        ),
        checkColor: const WidgetStatePropertyAll(Colors.white),
        side: const BorderSide(color: AppColors.hairlineStrong, width: 1.5),
        shape: const RoundedRectangleBorder(borderRadius: Radii.chip),
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.brand,
        linearTrackColor: AppColors.high,
        circularTrackColor: Colors.transparent,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: text,
        unselectedLabelColor: AppColors.textTertiary,
        labelStyle: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w800),
        unselectedLabelStyle: AppText.bodyStrong,
        indicator: const UnderlineTabIndicator(
          borderSide: BorderSide(color: text, width: 2.4),
          borderRadius: BorderRadius.vertical(top: Radius.circular(2)),
        ),
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: AppColors.hairline,
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.raised,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: Radii.sheet),
        showDragHandle: false,
        elevation: 0,
        modalElevation: 0,
        modalBarrierColor: Color(0x73101828),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.raised,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: Radii.card),
        titleTextStyle: c(AppText.headline),
        contentTextStyle: c(AppText.body, AppColors.textSecondary),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: text,
        contentTextStyle: c(AppText.bodyStrong, Colors.white),
        actionTextColor: const Color(0xFFFF8A73),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        insetPadding: const EdgeInsets.fromLTRB(
          Space.gutter,
          0,
          Space.gutter,
          Space.x3,
        ),
        shape: const RoundedRectangleBorder(borderRadius: Radii.button),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: const BoxDecoration(color: text, borderRadius: Radii.chip),
        textStyle: c(AppText.caption, Colors.white),
      ),

      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.fuchsia: FadeForwardsPageTransitionsBuilder(),
        },
      ),
    );
  }
}
