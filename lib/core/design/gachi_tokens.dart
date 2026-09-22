import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Published Sites V33. Existing AppColors remain available to deferred screens.
abstract final class GachiColors {
  static const navy = Color(0xFF081C32);
  static const ink = Color(0xFF10253D);
  static const ivory = Color(0xFFF7F3EA);
  static const surface = Color(0xFFFFFDF9);
  static const gold = Color(0xFFCFAA61);
  static const divider = Color(0xFFE7E3DA);
  static const secondary = Color(0xFF526174);
  static const muted = Color(0xFF64748A);
  static const error = Color(0xFFAF3434);
}

abstract final class GachiSpace {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0;
  static const page = 20.0, xl = 24.0, section = 32.0;
  static const pageInsets = EdgeInsets.symmetric(horizontal: page);
}

abstract final class GachiShape {
  static const radius = 12.0, smallRadius = 8.0;
  static const card = BorderRadius.all(Radius.circular(radius));
  static const small = BorderRadius.all(Radius.circular(smallRadius));
  static const shadow = [
    BoxShadow(color: Color(0x090B2032), blurRadius: 16, offset: Offset(0, 4)),
  ];
}

abstract final class GachiSize {
  static const button = 50.0, touch = 48.0, icon = 22.0;
  static const navIcon = 21.0, iconStroke = 1.6, bottomInset = 8.0;
}

abstract final class GachiType {
  static const display = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 30,
    height: 1.24,
    fontWeight: FontWeight.w800,
    letterSpacing: -.8,
  );
  static const pageTitle = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 26,
    height: 1.3,
    fontWeight: FontWeight.w800,
    letterSpacing: -.65,
  );
  static const section = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 19,
    height: 1.4,
    fontWeight: FontWeight.w700,
    letterSpacing: -.4,
  );
  static const product = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w700,
    letterSpacing: -.25,
  );
  static const body = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 15,
    height: 1.6,
  );
  static const meta = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 12,
    height: 1.5,
  );
  static const english = TextStyle(
    color: GachiColors.ink,
    fontFamily: 'Pretendard',
    fontSize: 11,
    height: 1.5,
    fontWeight: FontWeight.w700,
    letterSpacing: 1.6,
  );
}

/// Scoped to V33 presentation; does not change deferred commerce/account themes.
class GachiTheme extends StatelessWidget {
  final Widget child;
  const GachiTheme({super.key, required this.child});
  static ThemeData get data {
    final base = ThemeData(
      useMaterial3: true,
      fontFamily: 'Pretendard',
      colorScheme: const ColorScheme.light(
        primary: GachiColors.navy,
        onPrimary: GachiColors.surface,
        secondary: GachiColors.gold,
        onSecondary: GachiColors.navy,
        surface: GachiColors.surface,
        onSurface: GachiColors.ink,
        error: GachiColors.error,
      ),
    );
    final shape = RoundedRectangleBorder(borderRadius: GachiShape.card);
    return base.copyWith(
      scaffoldBackgroundColor: GachiColors.ivory,
      textTheme: base.textTheme
          .apply(bodyColor: GachiColors.ink, displayColor: GachiColors.ink)
          .copyWith(
            bodyMedium: GachiType.body,
            titleLarge: GachiType.pageTitle,
            titleMedium: GachiType.section,
          ),
      iconTheme: const IconThemeData(
        color: GachiColors.ink,
        size: GachiSize.icon,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: GachiColors.ivory,
        foregroundColor: GachiColors.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
        titleTextStyle: TextStyle(
          fontFamily: 'Pretendard',
          fontSize: 19,
          fontWeight: FontWeight.w700,
          color: GachiColors.ink,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(GachiSize.touch, GachiSize.button),
          shape: shape,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          textStyle: GachiType.product,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(GachiSize.touch, GachiSize.button),
          shape: shape,
          side: const BorderSide(color: GachiColors.divider),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          textStyle: GachiType.product,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(GachiSize.touch, GachiSize.touch),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: GachiColors.surface,
        hintStyle: GachiType.body.copyWith(color: GachiColors.muted),
        contentPadding: const EdgeInsets.all(GachiSpace.lg),
        border: OutlineInputBorder(
          borderRadius: GachiShape.card,
          borderSide: const BorderSide(color: GachiColors.divider),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: GachiShape.card,
          borderSide: const BorderSide(color: GachiColors.divider),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: GachiColors.surface,
        selectedColor: GachiColors.navy,
        side: const BorderSide(color: GachiColors.divider),
        shape: shape,
        padding: const EdgeInsets.all(GachiSpace.sm),
      ),
      dividerTheme: const DividerThemeData(
        color: GachiColors.divider,
        thickness: 1,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Theme(data: data, child: child);
}
