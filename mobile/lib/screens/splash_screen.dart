import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/portal_theme.dart';

/// Brand splash shown once on launch, before onboarding.
///
/// Stays until the person taps, then plays an exit before handing off.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.onDone});

  final VoidCallback onDone;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  late final AnimationController _enter;
  late final AnimationController _exit;
  late final AnimationController _pulse;
  late final AnimationController _glow;

  late final Animation<double> _bgFade;
  late final Animation<double> _logoScale;
  late final Animation<double> _logoFade;
  late final Animation<double> _logoRise;
  late final Animation<double> _titleFade;
  late final Animation<double> _titleRise;
  late final Animation<double> _tagFade;
  late final Animation<double> _cueFade;
  late final Animation<double> _pulseFade;
  late final Animation<double> _glowPulse;
  late final Animation<double> _exitFade;
  late final Animation<double> _exitScale;
  late final Animation<Offset> _exitSlide;

  bool _leaving = false;

  @override
  void initState() {
    super.initState();

    _enter = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );
    _exit = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
    );
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);
    _glow = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2800),
    )..repeat(reverse: true);

    _bgFade = CurvedAnimation(
      parent: _enter,
      curve: const Interval(0.0, 0.35, curve: Curves.easeOut),
    );
    _logoFade = CurvedAnimation(
      parent: _enter,
      curve: const Interval(0.08, 0.48, curve: Curves.easeOut),
    );
    _logoScale = Tween<double>(begin: 0.72, end: 1).animate(
      CurvedAnimation(
        parent: _enter,
        curve: const Interval(0.08, 0.55, curve: Curves.easeOutBack),
      ),
    );
    _logoRise = Tween<double>(begin: 36, end: 0).animate(
      CurvedAnimation(
        parent: _enter,
        curve: const Interval(0.08, 0.5, curve: Curves.easeOutCubic),
      ),
    );
    _titleFade = CurvedAnimation(
      parent: _enter,
      curve: const Interval(0.32, 0.7, curve: Curves.easeOut),
    );
    _titleRise = Tween<double>(begin: 22, end: 0).animate(
      CurvedAnimation(
        parent: _enter,
        curve: const Interval(0.32, 0.72, curve: Curves.easeOutCubic),
      ),
    );
    _tagFade = CurvedAnimation(
      parent: _enter,
      curve: const Interval(0.48, 0.85, curve: Curves.easeOut),
    );
    _cueFade = CurvedAnimation(
      parent: _enter,
      curve: const Interval(0.68, 1.0, curve: Curves.easeOut),
    );

    _pulseFade = Tween<double>(begin: 0.3, end: 1).animate(
      CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
    );
    _glowPulse = Tween<double>(begin: 0.75, end: 1.12).animate(
      CurvedAnimation(parent: _glow, curve: Curves.easeInOut),
    );

    _exitFade = Tween<double>(begin: 1, end: 0).animate(
      CurvedAnimation(parent: _exit, curve: Curves.easeIn),
    );
    _exitScale = Tween<double>(begin: 1, end: 1.08).animate(
      CurvedAnimation(parent: _exit, curve: Curves.easeInCubic),
    );
    _exitSlide = Tween<Offset>(
      begin: Offset.zero,
      end: const Offset(0, -0.04),
    ).animate(CurvedAnimation(parent: _exit, curve: Curves.easeInCubic));

    _enter.forward();
  }

  @override
  void dispose() {
    _enter.dispose();
    _exit.dispose();
    _pulse.dispose();
    _glow.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    if (_leaving) return;
    _leaving = true;
    _pulse.stop();
    _glow.stop();
    await _exit.forward();
    if (!mounted) return;
    widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final logoSize = (size.width * 0.36).clamp(120.0, 156.0);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _finish,
        child: Scaffold(
          backgroundColor: PortalColors.background,
          body: AnimatedBuilder(
            animation: Listenable.merge([_enter, _exit, _pulse, _glow]),
            builder: (context, _) {
              return FadeTransition(
                opacity: _exitFade,
                child: SlideTransition(
                  position: _exitSlide,
                  child: ScaleTransition(
                    scale: _exitScale,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Opacity(
                          opacity: _bgFade.value,
                          child: const DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  Color(0xFFF6F2E6),
                                  PortalColors.background,
                                  Color(0xFFECE6D6),
                                ],
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          top: size.height * 0.1,
                          left: -size.width * 0.28,
                          child: Transform.scale(
                            scale: _glowPulse.value,
                            child: Container(
                              width: size.width * 0.72,
                              height: size.width * 0.72,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: PortalColors.primaryLight
                                    .withValues(alpha: 0.18),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          bottom: size.height * 0.06,
                          right: -size.width * 0.22,
                          child: Transform.scale(
                            scale: 2.1 - _glowPulse.value,
                            child: Container(
                              width: size.width * 0.58,
                              height: size.width * 0.58,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: PortalColors.gold.withValues(alpha: 0.12),
                              ),
                            ),
                          ),
                        ),
                        SafeArea(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(32, 24, 32, 40),
                            child: Column(
                              children: [
                                const Spacer(flex: 5),
                                Opacity(
                                  opacity: _logoFade.value,
                                  child: Transform.translate(
                                    offset: Offset(0, _logoRise.value),
                                    child: Transform.scale(
                                      scale: _logoScale.value,
                                      child: Container(
                                        height: logoSize,
                                        width: logoSize,
                                        padding: const EdgeInsets.all(16),
                                        decoration: BoxDecoration(
                                          color: PortalColors.surface,
                                          borderRadius:
                                              BorderRadius.circular(28),
                                          boxShadow: PortalClay.raised,
                                        ),
                                        child: Image.asset(
                                          'assets/brand/agrifair_logo.png',
                                          fit: BoxFit.contain,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 28),
                                Opacity(
                                  opacity: _titleFade.value,
                                  child: Transform.translate(
                                    offset: Offset(0, _titleRise.value),
                                    child: Text(
                                      'AgriFair',
                                      style: portalDisplay(
                                        size: 38,
                                        height: 1,
                                        color: PortalColors.textDark,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Opacity(
                                  opacity: _tagFade.value,
                                  child: Text(
                                    'Rice from verified shops',
                                    textAlign: TextAlign.center,
                                    style: portalBody(
                                      size: 14.5,
                                      color: PortalColors.textMuted,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                                const Spacer(flex: 6),
                                Opacity(
                                  opacity: _cueFade.value * _pulseFade.value,
                                  child: Text(
                                    'Tap to continue',
                                    style: portalBody(
                                      size: 13,
                                      weight: FontWeight.w600,
                                      color: PortalColors.primaryDark,
                                    ).copyWith(letterSpacing: 0.6),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
