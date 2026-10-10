import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// The same look as the web: a cream page, cards a shade lighter, forest
/// greens for buttons and dark banners, and gold for highlights. Headings in
/// Fraunces, everything else in DM Sans. Keep these in step with the tokens
/// at the top of frontend/src/index.css.
class AppColors {
  // Grounds.
  static const Color background = Color(0xFFF4F0E6);
  static const Color surface = Color(0xFFFFFCF5);
  static const Color surfaceSunken = Color(0xFFECE6D6);

  // Brand
  static const Color primaryDark = Color(0xFF122112);
  static const Color primaryMedium = Color(0xFF2D5A2D);
  static const Color primaryLight = Color(0xFF7DBF7D);
  static const Color accent = Color(0xFFC9A84C);
  static const Color accentLight = Color(0xFFE8C97B);

  // Ink
  static const Color textDark = Color(0xFF141A14);
  static const Color textBody = Color(0xFF4B5148);
  static const Color textMuted = Color(0xFF6B7268);

  // Meaning, kept apart from the brand green
  static const Color error = Color(0xFFC43C3C);
  static const Color success = Color(0xFF2F7A52);
  static const Color warning = Color(0xFF7A5F18);

  // Shadows are forest-tinted, never grey, as on the web.
  static const Color shadowDark = Color(0x17122112);
  static const Color shadowLight = Color(0x00FFFFFF);

  static const Color border = Color(0x29122112);
  static const Color inputFill = Color(0xFFFFFCF5);
}

/// The web's radius scale: 10 for controls, 16 for cards.
class AppRadius {
  static const double sm = 10;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double pill = 999;
}

class AppShadows {
  /// Cards and anything that sits on the page (the web's --sh-md).
  static const List<BoxShadow> raised = [
    BoxShadow(
      color: Color(0x17122112),
      offset: Offset(0, 12),
      blurRadius: 28,
    ),
  ];

  /// For rows repeated down a list (the web's --sh-sm).
  static const List<BoxShadow> subtle = [
    BoxShadow(
      color: Color(0x0D122112),
      offset: Offset(0, 6),
      blurRadius: 18,
    ),
  ];

  /// Under the primary green button.
  static const List<BoxShadow> accent = [
    BoxShadow(
      color: Color(0x332D5A2D),
      offset: Offset(0, 8),
      blurRadius: 18,
    ),
  ];
}

TextTheme _buildTextTheme(TextTheme base) {
  // DM Sans for reading, Fraunces for headings: the web's pairing.
  final text = GoogleFonts.dmSansTextTheme(base);
  TextStyle? display(TextStyle? style) =>
      style == null ? null : GoogleFonts.fraunces(textStyle: style);

  return text.copyWith(
    displayLarge: display(text.displayLarge)?.copyWith(
      fontWeight: FontWeight.w800,
      letterSpacing: -1.2,
      color: AppColors.textDark,
    ),
    headlineLarge: display(text.headlineLarge)?.copyWith(
      fontWeight: FontWeight.w800,
      letterSpacing: -0.8,
      color: AppColors.textDark,
    ),
    headlineMedium: display(text.headlineMedium)?.copyWith(
      fontWeight: FontWeight.w700,
      letterSpacing: -0.5,
      color: AppColors.textDark,
    ),
    titleLarge: display(text.titleLarge)?.copyWith(
      fontWeight: FontWeight.w700,
      letterSpacing: -0.3,
      color: AppColors.textDark,
    ),
    titleMedium: text.titleMedium?.copyWith(
      fontWeight: FontWeight.w600,
      color: AppColors.textDark,
    ),
    bodyLarge: text.bodyLarge?.copyWith(color: AppColors.textBody, height: 1.5),
    bodyMedium: text.bodyMedium?.copyWith(color: AppColors.textBody, height: 1.5),
    bodySmall: text.bodySmall?.copyWith(color: AppColors.textMuted, height: 1.4),
    labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w700),
  );
}

ThemeData buildAppTheme() {
  final base = ThemeData(useMaterial3: true, brightness: Brightness.light);

  return base.copyWith(
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: const ColorScheme.light(
      primary: AppColors.primaryMedium,
      onPrimary: Colors.white,
      secondary: AppColors.accent,
      surface: AppColors.surface,
      onSurface: AppColors.textDark,
      error: AppColors.error,
    ),
    textTheme: _buildTextTheme(base.textTheme),
    splashFactory: InkRipple.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      iconTheme: const IconThemeData(color: AppColors.textDark),
      titleTextStyle: GoogleFonts.fraunces(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
        color: AppColors.textDark,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.inputFill,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: Color(0xFF4A8C4A), width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.error, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.error, width: 2),
      ),
      hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 15),
      labelStyle: const TextStyle(color: AppColors.textMuted),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.primaryDark,
      contentTextStyle: GoogleFonts.dmSans(
        color: Colors.white,
        fontSize: 13.5,
        fontWeight: FontWeight.w500,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      insetPadding: const EdgeInsets.all(16),
    ),
    dividerTheme: const DividerThemeData(
      color: Color(0x17122112),
      thickness: 1,
      space: 1,
    ),
  );
}
