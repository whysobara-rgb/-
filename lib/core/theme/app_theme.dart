import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// 가치가차 테마 두 벌.
///
/// - [vault]: 로그인 후 앱 전체. 먹색 표면 3단 + 오프화이트 텍스트 +
///   볼트 제이드 액센트 하나. 위계는 그림자 대신 표면 밝기와 헤어라인으로.
/// - [paper]: 로그인·가입 화면 전용(1차 디자인 유지). auth 화면이
///   흰 바탕을 전제로 색을 직접 지정하고 있어서 그대로 둔다.
///
/// 컬러/타입/간격 토큰은 [AppColors], [AppText], [Space]/[Radii]에서만 정의한다.
class AppTheme {
  AppTheme._();

  static ThemeData get vault => _build(
    const _Palette(
      brightness: Brightness.dark,
      bg: AppColors.canvas,
      surface: AppColors.surface,
      raised: AppColors.raised,
      track: AppColors.high,
      line: AppColors.hairline,
      lineStrong: AppColors.hairlineStrong,
      text: AppColors.text,
      textSecondary: AppColors.textSecondary,
      textTertiary: AppColors.textTertiary,
      accent: AppColors.brand,
      onAccent: AppColors.onBrand,
      danger: AppColors.danger,
      snack: AppColors.text,
      onSnack: AppColors.canvas,
      overlay: SystemUiOverlayStyle.light,
    ),
  );

  static ThemeData get paper => _build(
    const _Palette(
      brightness: Brightness.light,
      bg: AppColors.bg,
      surface: AppColors.bg,
      raised: AppColors.bg,
      track: Color(0xFFEDEDEB),
      line: AppColors.line,
      lineStrong: Color(0xFFD4D4D4),
      text: AppColors.ink,
      textSecondary: AppColors.inkSecondary,
      textTertiary: AppColors.inkTertiary,
      accent: AppColors.accent,
      onAccent: AppColors.onInk,
      danger: Color(0xFFD93A2B),
      snack: AppColors.ink,
      onSnack: AppColors.onInk,
      overlay: SystemUiOverlayStyle.dark,
    ),
  );

  static ThemeData _build(_Palette p) {
    final base = ThemeData(
      brightness: p.brightness,
      useMaterial3: true,
      fontFamily: AppText.family,
      splashFactory: InkRipple.splashFactory,
    );

    final scheme =
        ColorScheme.fromSeed(
          seedColor: p.accent,
          brightness: p.brightness,
        ).copyWith(
          primary: p.accent,
          onPrimary: p.onAccent,
          secondary: p.text,
          onSecondary: p.bg,
          surface: p.bg,
          onSurface: p.text,
          onSurfaceVariant: p.textSecondary,
          surfaceContainerLowest: p.bg,
          surfaceContainerLow: p.surface,
          surfaceContainer: p.surface,
          surfaceContainerHigh: p.raised,
          surfaceContainerHighest: p.raised,
          outline: p.lineStrong,
          outlineVariant: p.line,
          error: p.danger,
          onError: Colors.white,
          surfaceTint: Colors.transparent,
          inverseSurface: p.snack,
          onInverseSurface: p.onSnack,
        );

    TextStyle c(TextStyle s, [Color? color]) =>
        s.copyWith(color: color ?? p.text);

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: p.bg,
      canvasColor: p.bg,
      dividerColor: p.line,
      splashColor: p.text.withValues(alpha: 0.05),
      highlightColor: p.text.withValues(alpha: 0.03),

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
          .apply(bodyColor: p.text, displayColor: p.text),

      appBarTheme: AppBarTheme(
        backgroundColor: p.bg,
        foregroundColor: p.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleSpacing: Space.gutter,
        surfaceTintColor: Colors.transparent,
        toolbarHeight: 52,
        titleTextStyle: c(AppText.title2),
        iconTheme: IconThemeData(color: p.text, size: 24),
        actionsIconTheme: IconThemeData(color: p.text, size: 24),
        systemOverlayStyle: p.overlay,
      ),

      iconTheme: IconThemeData(color: p.text, size: 24),

      dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: p.accent,
          foregroundColor: p.onAccent,
          disabledBackgroundColor: p.track,
          disabledForegroundColor: p.textTertiary,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
          elevation: 0,
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: p.accent,
          foregroundColor: p.onAccent,
          elevation: 0,
          minimumSize: const Size(0, 52),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p.text,
          disabledForegroundColor: p.textTertiary,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: Space.x5),
          side: BorderSide(color: p.lineStrong),
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
          textStyle: AppText.headline,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: p.text,
          textStyle: AppText.bodyStrong,
          shape: const RoundedRectangleBorder(borderRadius: Radii.button),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: p.raised,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Space.x4,
          vertical: 15,
        ),
        hintStyle: AppText.body.copyWith(color: p.textTertiary),
        labelStyle: c(AppText.caption, p.textSecondary),
        floatingLabelStyle: c(AppText.caption),
        suffixStyle: c(AppText.body, p.textSecondary),
        border: OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: p.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: p.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: p.text, width: 1.2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: Radii.button,
          borderSide: BorderSide(color: p.danger),
        ),
      ),

      textSelectionTheme: TextSelectionThemeData(
        cursorColor: p.text,
        selectionHandleColor: p.text,
        selectionColor: p.accent.withValues(alpha: 0.3),
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? (p.brightness == Brightness.dark ? p.accent : p.text)
              : Colors.transparent,
        ),
        checkColor: WidgetStatePropertyAll(
          p.brightness == Brightness.dark ? p.onAccent : p.bg,
        ),
        side: BorderSide(color: p.lineStrong, width: 1.5),
        shape: const RoundedRectangleBorder(borderRadius: Radii.chip),
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: p.text,
        linearTrackColor: p.track,
        circularTrackColor: Colors.transparent,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: p.text,
        unselectedLabelColor: p.textTertiary,
        labelStyle: AppText.bodyStrong,
        unselectedLabelStyle: AppText.bodyStrong,
        indicatorColor: p.text,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: p.line,
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.raised,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: Radii.sheet),
        showDragHandle: false,
        elevation: 0,
        modalElevation: 0,
        modalBarrierColor: const Color(0x99000000),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: p.raised,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: Radii.card),
        titleTextStyle: c(AppText.headline),
        contentTextStyle: c(AppText.body, p.textSecondary),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: p.snack,
        contentTextStyle: c(AppText.bodyStrong, p.onSnack),
        actionTextColor: p.brightness == Brightness.dark
            ? AppColors.brandPressed
            : p.onSnack,
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
        decoration: BoxDecoration(color: p.snack, borderRadius: Radii.chip),
        textStyle: c(AppText.caption, p.onSnack),
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

class _Palette {
  final Brightness brightness;
  final Color bg;
  final Color surface;
  final Color raised;
  final Color track;
  final Color line;
  final Color lineStrong;
  final Color text;
  final Color textSecondary;
  final Color textTertiary;
  final Color accent;
  final Color onAccent;
  final Color danger;
  final Color snack;
  final Color onSnack;
  final SystemUiOverlayStyle overlay;

  const _Palette({
    required this.brightness,
    required this.bg,
    required this.surface,
    required this.raised,
    required this.track,
    required this.line,
    required this.lineStrong,
    required this.text,
    required this.textSecondary,
    required this.textTertiary,
    required this.accent,
    required this.onAccent,
    required this.danger,
    required this.snack,
    required this.onSnack,
    required this.overlay,
  });
}
