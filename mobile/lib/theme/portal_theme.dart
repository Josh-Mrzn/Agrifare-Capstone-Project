import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// The sign-in screens' palette: the same tokens as AppColors and the web.
class PortalColors {
  static const Color background = Color(0xFFF4F0E6);
  static const Color surface = Color(0xFFFFFCF5);
  static const Color surfaceSunken = Color(0xFFECE6D6);
  static const Color primaryDark = Color(0xFF122112);
  static const Color primaryMedium = Color(0xFF2D5A2D);
  static const Color primaryLight = Color(0xFF7DBF7D);
  static const Color gold = Color(0xFFC9A84C);
  static const Color goldLight = Color(0xFFE8C97B);
  static const Color cream = Color(0xFFF4F0E6);
  static const Color white = Color(0xFFFFFFFF);
  static const Color textDark = Color(0xFF141A14);
  static const Color textBody = Color(0xFF4B5148);
  static const Color textMuted = Color(0xFF6B7268);
  static const Color error = Color(0xFFC43C3C);

  static const Color green950 = Color(0xFF0F1D10);
  static const Color green900 = Color(0xFF122112);
  static const Color green800 = Color(0xFF1A2E1A);
  static const Color green700 = Color(0xFF2D5A2D);
  static const Color textMid = textBody;
  static const Color claySurface = surface;
  static const Color claySunken = surfaceSunken;
  static const Color clayRaised = Color(0xFFFFFFFF);
}

class PortalClay {
  static const List<BoxShadow> raised = [
    BoxShadow(color: Color(0x17122112), offset: Offset(0, 12), blurRadius: 28),
  ];

  static const List<BoxShadow> soft = [
    BoxShadow(color: Color(0x0D122112), offset: Offset(0, 6), blurRadius: 18),
  ];

  static const List<BoxShadow> primary = [
    BoxShadow(color: Color(0x332D5A2D), offset: Offset(0, 8), blurRadius: 18),
  ];

  static const List<BoxShadow> gold = [
    BoxShadow(color: Color(0x40C9A84C), offset: Offset(0, 8), blurRadius: 18),
  ];

  static const double radiusSm = 10;
  static const double radiusMd = 16;
  static const double radiusLg = 24;
}

TextStyle portalDisplay({
  double size = 32,
  FontWeight weight = FontWeight.w800,
  Color color = PortalColors.textDark,
  double height = 1.05,
}) {
  return GoogleFonts.fraunces(
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
    letterSpacing: -0.6,
  );
}

TextStyle portalBody({
  double size = 14,
  FontWeight weight = FontWeight.w400,
  Color color = PortalColors.textBody,
  double height = 1.55,
}) {
  return GoogleFonts.dmSans(
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
  );
}
