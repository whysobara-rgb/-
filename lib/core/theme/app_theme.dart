import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// 가치가차 테마.
///
/// 흰 바탕·잉크 텍스트·헤어라인으로 구성한 플랫 테마. 그림자와
/// 그라데이션 없이 선과 간격으로 위계를 만든다. 컬러/타입/간격 토큰은
/// [AppColors], [AppText], [Space]/[Radii]에서만 정의한다.
class AppTheme {
  AppTheme._();

  static ThemeData get light {
    final base = ThemeData(
      brightness: Brightness.light,
      useMaterial3: true,
      fontFamily: AppText.family,
      splashFactory: InkRipple.splashFactory,
    );

    final scheme =
        ColorScheme.fromSeed(
          seedColor: AppColors.accent,
          brightness: Brightness.light,
        ).copyWith(
          primary: AppColors.accent,
          onPrimary: AppColors.onInk,
          secondary: AppColors.ink,
          onSecondary: AppColors.onInk,
          surface: AppColors.bg,
          onSurface: AppColors.ink,
          onSurfaceVariant: AppColors.inkSecondary,
          surfaceContainerHighest: AppColors.bgSubtle,
          outline: AppColors.lineStrong,
          outlineVariant: AppColors.line,
          error: AppColors.negative,
          onError: AppColors.onInk,
          surfaceTint: Colors.transparent,
        );

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.bg,
      canvasColor: AppColors.bg,
      dividerColor: AppColors.line,
      splashColor: AppColors.ink.withValues(alpha: 0.04),
      highlightColor: AppColors.ink.withValues(alpha: 0.03),

      textTheme: base.textTheme
          .copyWith(
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
          .apply(bodyColor: AppColors.ink, displayColor: AppColors.ink),

      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.bg,
        foregroundColor: AppColors.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleSpacing: Space.gutter,
        surfaceTintColor: Colors.transparent,
        toolbarHeight: 52,
        titleTextStyle: AppText.title2,
        iconTheme: const IconThemeData(color: AppColors.ink, size: 24),
        actionsIconTheme: const IconThemeData(color: AppColors.ink, size: 24),
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),

      iconTheme: const IconThemeData(color: AppColors.ink, size: 24),

      dividerTheme: const DividerThemeData(
        color: AppColors.line,
        thickness: 1,
        space: 1,
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.accent,
          foregroundColor: AppColors.onInk,
          disabledBackgroundColor: AppColors.bgMuted,
          disabledForegroundColor: AppColors.inkTertiary,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
          elevation: 0,
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accent,
          foregroundColor: AppColors.onInk,
          elevation: 0,
          minimumSize: const Size(0, 52),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.ink,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          side: const BorderSide(color: AppColors.lineStrong),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.ink,
          textStyle: AppText.bodyStrong,
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.bg,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Space.x4,
          vertical: 15,
        ),
        hintStyle: AppText.body.copyWith(color: AppColors.inkTertiary),
        labelStyle: AppText.caption,
        floatingLabelStyle: AppText.caption.copyWith(color: AppColors.ink),
        border: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: AppColors.line),
        ),
        enabledBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: AppColors.line),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: AppColors.ink, width: 1.2),
        ),
        errorBorder: const OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: AppColors.negative),
        ),
      ),

      textSelectionTheme: const TextSelectionThemeData(
        cursorColor: AppColors.ink,
        selectionHandleColor: AppColors.ink,
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? AppColors.ink
              : Colors.transparent,
        ),
        checkColor: const WidgetStatePropertyAll(AppColors.onInk),
        side: const BorderSide(color: AppColors.lineStrong, width: 1.5),
        shape: const RoundedRectangleBorder(borderRadius: Radii.chip),
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.ink,
        linearTrackColor: AppColors.bgMuted,
        circularTrackColor: Colors.transparent,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.ink,
        unselectedLabelColor: AppColors.inkTertiary,
        labelStyle: AppText.bodyStrong,
        unselectedLabelStyle: AppText.bodyStrong,
        indicatorColor: AppColors.ink,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: AppColors.line,
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.bg,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: Radii.sheet),
        showDragHandle: false,
        elevation: 0,
        modalElevation: 0,
        modalBarrierColor: Color(0x66000000),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: Radii.card),
        titleTextStyle: AppText.headline,
        contentTextStyle: AppText.body.copyWith(color: AppColors.inkSecondary),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.ink,
        contentTextStyle: AppText.bodyStrong.copyWith(color: AppColors.onInk),
        actionTextColor: AppColors.onInk,
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
