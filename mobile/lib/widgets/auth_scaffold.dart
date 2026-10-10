import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/portal_theme.dart';

/// Light clay auth chrome.
///
/// Sign-in fits one viewport with no scroll ([scrollable] false). Longer forms
/// like sign-up opt into scrolling.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.label = 'Account Access',
    this.onBack,
    this.footer,
    this.scrollable = false,
    this.sitLower = false,
  });

  final String title;
  final String subtitle;
  final String label;
  final List<Widget> children;
  final VoidCallback? onBack;
  final Widget? footer;
  final bool scrollable;

  /// Moves the form further down the screen while the keyboard is closed, and
  /// uses a larger logo set a little lower. For short forms (sign-in) that
  /// would otherwise leave the bottom empty.
  final bool sitLower;

  static const _logoSize = 68.0;
  static const _largeLogoSize = 84.0;

  @override
  Widget build(BuildContext context) {
    final brand = _AuthBrand(
      onBack: onBack,
      logoSize: sitLower ? _largeLogoSize : _logoSize,
      logoGap: sitLower ? 12 : 2,
    );
    final form = _AuthForm(
      title: title,
      subtitle: subtitle,
      footer: footer,
      children: children,
    );

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Theme(
        data: _authInputTheme(context),
        child: Scaffold(
          backgroundColor: PortalColors.background,
          resizeToAvoidBottomInset: true,
          body: Stack(
            children: [
              const _SoftLeaves(),
              SafeArea(
                // One tree always — swapping FittedBox ↔ ScrollView on keyboard
                // rebuild destroyed the field and bounced the keyboard closed.
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final keyboardOpen =
                        MediaQuery.viewInsetsOf(context).bottom > 0;
                    // Extra top air only when the keyboard is down and the
                    // screen is meant to sit lower (sign-in), not on longer forms.
                    var topGap = scrollable
                        ? 28.0
                        : (keyboardOpen
                            ? 20.0
                            : (constraints.maxHeight * 0.12)
                                .clamp(28.0, 72.0));
                    // Scaled to the screen, so a small phone gets less and
                    // the button stays in reach without scrolling.
                    if (sitLower && !scrollable && !keyboardOpen) {
                      topGap += (constraints.maxHeight * 0.07)
                          .clamp(0.0, 52.0);
                    }

                    return SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: constraints.maxHeight - 8,
                          maxWidth: 420,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            brand,
                            SizedBox(height: topGap),
                            form,
                            if (!scrollable && !keyboardOpen)
                              SizedBox(
                                height: (constraints.maxHeight * 0.08)
                                    .clamp(12.0, 40.0),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  ThemeData _authInputTheme(BuildContext context) {
    OutlineInputBorder border(Color color, [double width = 0]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(PortalClay.radiusMd),
          borderSide: width == 0
              ? BorderSide.none
              : BorderSide(color: color, width: width),
        );

    return Theme.of(context).copyWith(
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: PortalColors.clayRaised,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        hintStyle: portalBody(size: 14, color: PortalColors.textMuted),
        prefixIconColor: PortalColors.textMuted,
        suffixIconColor: PortalColors.textMuted,
        border: border(Colors.transparent),
        enabledBorder: border(const Color(0x29122112), 1.2),
        focusedBorder: border(PortalColors.primaryMedium, 1.6),
        errorBorder: border(PortalColors.error, 1.4),
        focusedErrorBorder: border(PortalColors.error, 1.6),
        errorStyle: portalBody(size: 11.5, color: PortalColors.error),
      ),
    );
  }
}

class _AuthBrand extends StatelessWidget {
  const _AuthBrand({
    required this.logoSize,
    this.logoGap = 2,
    this.onBack,
  });

  final double logoSize;

  /// Space between the AGRIFAIR wordmark and the logo tile.
  final double logoGap;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 32,
          child: Row(
            children: [
              if (onBack != null)
                _ClayChip(
                  onTap: onBack!,
                  child: const Icon(
                    Icons.arrow_back_rounded,
                    size: 20,
                    color: PortalColors.textDark,
                  ),
                )
              else
                const SizedBox(width: 40),
              Expanded(
                child: Text(
                  'AGRIFAIR',
                  textAlign: TextAlign.center,
                  style: portalBody(
                    size: 12,
                    weight: FontWeight.w800,
                    color: PortalColors.primaryDark,
                  ).copyWith(letterSpacing: 2.4),
                ),
              ),
              const SizedBox(width: 40),
            ],
          ),
        ),
        SizedBox(height: logoGap),
        Center(
          child: Container(
            height: logoSize,
            width: logoSize,
            // Padding and corners scale with the tile, so a larger logo keeps
            // the same proportions as the 68px one (8px padding, 18px radius).
            padding: EdgeInsets.all(logoSize * 8 / 68),
            decoration: BoxDecoration(
              color: PortalColors.surface,
              borderRadius: BorderRadius.circular(logoSize * 18 / 68),
              boxShadow: PortalClay.raised,
            ),
            child: Image.asset(
              'assets/brand/agrifair_logo.png',
              fit: BoxFit.contain,
            ),
          ),
        ),
      ],
    );
  }
}

class _AuthForm extends StatelessWidget {
  const _AuthForm({
    required this.title,
    required this.subtitle,
    required this.children,
    this.footer,
  });

  final String title;
  final String subtitle;
  final List<Widget> children;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: portalDisplay(size: 24)),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: portalBody(
              size: 13,
              color: PortalColors.textMuted,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 16),
          ...children,
          if (footer != null) ...[
            const SizedBox(height: 14),
            footer!,
          ],
        ],
      ),
    );
  }
}

class _SoftLeaves extends StatelessWidget {
  const _SoftLeaves();

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: Stack(
          children: [
            Positioned(
              top: -40,
              right: -30,
              child: Icon(
                Icons.eco_rounded,
                size: 150,
                color: PortalColors.primaryLight.withValues(alpha: 0.14),
              ),
            ),
            Positioned(
              top: 12,
              left: -36,
              child: Transform.rotate(
                angle: -0.5,
                child: Icon(
                  Icons.eco_rounded,
                  size: 110,
                  color: PortalColors.primaryMedium.withValues(alpha: 0.10),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ClayChip extends StatelessWidget {
  const _ClayChip({required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 40,
        width: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: PortalColors.surface,
          borderRadius: BorderRadius.circular(12),
          boxShadow: PortalClay.soft,
        ),
        child: child,
      ),
    );
  }
}

class AuthClayField extends StatelessWidget {
  const AuthClayField({
    super.key,
    required this.child,
    this.hasError = false,
  });

  final Widget child;
  final bool hasError;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(
        color: PortalColors.clayRaised,
        borderRadius: BorderRadius.circular(PortalClay.radiusMd),
        border: Border.all(
          color: hasError
              ? PortalColors.error.withValues(alpha: 0.55)
              : const Color(0x29122112),
          width: 1.2,
        ),
      ),
      child: child,
    );
  }
}

class AuthButton extends StatefulWidget {
  const AuthButton({
    super.key,
    required this.label,
    this.onPressed,
    this.isLoading = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final IconData? icon;

  @override
  State<AuthButton> createState() => _AuthButtonState();
}

class _AuthButtonState extends State<AuthButton> {
  bool _down = false;

  bool get _enabled => widget.onPressed != null && !widget.isLoading;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: _enabled ? (_) => setState(() => _down = true) : null,
      onTapUp: _enabled ? (_) => setState(() => _down = false) : null,
      onTapCancel: _enabled ? () => setState(() => _down = false) : null,
      onTap: _enabled ? widget.onPressed : null,
      child: AnimatedScale(
        scale: _down ? 0.97 : 1,
        duration: const Duration(milliseconds: 110),
        child: AnimatedOpacity(
          opacity: _enabled ? 1 : 0.5,
          duration: const Duration(milliseconds: 150),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 110),
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
            decoration: BoxDecoration(
              color: PortalColors.primaryDark,
              borderRadius: BorderRadius.circular(PortalClay.radiusMd),
              boxShadow: _down ? const [] : PortalClay.primary,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.isLoading)
                  const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      valueColor: AlwaysStoppedAnimation(Colors.white),
                    ),
                  )
                else ...[
                  Flexible(
                    child: Text(
                      widget.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: portalBody(
                        size: 15,
                        weight: FontWeight.w700,
                        color: Colors.white,
                        height: 1.2,
                      ),
                    ),
                  ),
                  if (widget.icon != null) ...[
                    const SizedBox(width: 8),
                    Icon(widget.icon, size: 18, color: Colors.white),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class AuthFooterLink extends StatelessWidget {
  const AuthFooterLink({
    super.key,
    required this.question,
    required this.action,
    required this.onTap,
  });

  final String question;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      runSpacing: 2,
      children: [
        Text(
          question,
          style: portalBody(size: 13, color: PortalColors.textMuted),
        ),
        GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Text(
            action,
            style: portalBody(
              size: 13,
              weight: FontWeight.w800,
              color: PortalColors.primaryMedium,
            ),
          ),
        ),
      ],
    );
  }
}

class AuthFieldPrefix extends StatelessWidget {
  const AuthFieldPrefix(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 14, right: 8),
      child: Text(
        text,
        style: portalBody(
          size: 11,
          weight: FontWeight.w700,
          color: PortalColors.textMuted,
          height: 1,
        ).copyWith(letterSpacing: 0.6),
      ),
    );
  }
}

class AuthClayWell extends StatelessWidget {
  const AuthClayWell({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final well = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: PortalColors.surface,
        borderRadius: BorderRadius.circular(PortalClay.radiusMd),
        boxShadow: PortalClay.soft,
      ),
      child: child,
    );

    if (onTap == null) return well;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(PortalClay.radiusMd),
        child: well,
      ),
    );
  }
}
