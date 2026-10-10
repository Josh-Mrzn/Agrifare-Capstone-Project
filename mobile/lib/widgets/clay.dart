import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A raised clay surface. The building block everything else here is made of.
class ClayCard extends StatelessWidget {
  const ClayCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.radius = AppRadius.lg,
    this.color = AppColors.surface,
    this.shadows,
    this.onTap,
    this.margin,
    this.width,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color color;
  final List<BoxShadow>? shadows;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? margin;
  final double? width;

  @override
  Widget build(BuildContext context) {
    final shape = BorderRadius.circular(radius);

    return Container(
      width: width,
      margin: margin,
      decoration: BoxDecoration(
        color: color,
        borderRadius: shape,
        boxShadow: shadows ?? AppShadows.raised,
      ),
      // The ink splash is clipped to the same curve, so a tap does not paint a
      // square ripple over a rounded shape.
      child: Material(
        color: Colors.transparent,
        borderRadius: shape,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: shape,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// A surface pressed *into* the page instead of lifted off it. Used for things
/// that receive rather than offer: fields, wells, unselected slots.
class ClaySunken extends StatelessWidget {
  const ClaySunken({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = AppRadius.md,
    this.color = AppColors.surfaceSunken,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        // Inner shadows are not a thing in Flutter's BoxDecoration, so the
        // recess is faked: a darker fill inside a thin hairline.
        //
        // The hairline has to be uniform. A Border with different sides cannot
        // be painted with a borderRadius - Flutter asserts "the following is
        // not uniform" and paints nothing at all, which is why every sunken
        // panel in the app was coming out flat.
        border: Border.all(color: const Color(0x17122112), width: 1.2),
      ),
      child: child,
    );
  }
}

/// The main action button. Presses down slightly, which is most of what makes
/// a clay control feel like clay.
class ClayButton extends StatefulWidget {
  const ClayButton({
    super.key,
    required this.label,
    this.onPressed,
    this.isLoading = false,
    this.icon,
    this.filled = true,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final IconData? icon;

  /// Filled means the green primary; otherwise a raised neutral surface.
  final bool filled;
  final bool expand;

  @override
  State<ClayButton> createState() => _ClayButtonState();
}

class _ClayButtonState extends State<ClayButton> {
  bool _down = false;

  bool get _enabled => widget.onPressed != null && !widget.isLoading;

  @override
  Widget build(BuildContext context) {
    final background = widget.filled ? AppColors.primaryMedium : AppColors.surface;
    final foreground = widget.filled ? Colors.white : AppColors.textDark;

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
          child: Container(
            width: widget.expand ? double.infinity : null,
            padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 17),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              boxShadow: _down
                  ? const []
                  : (widget.filled ? AppShadows.accent : AppShadows.raised),
            ),
            child: Row(
              mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.isLoading)
                  SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      valueColor: AlwaysStoppedAnimation(foreground),
                    ),
                  )
                else ...[
                  if (widget.icon != null) ...[
                    Icon(widget.icon, size: 18, color: foreground),
                    const SizedBox(width: 9),
                  ],
                  // Flexible, so a long label shortens instead of running off
                  // the edge. A button whose words do not fit is the black and
                  // yellow stripe people photograph and send you.
                  Flexible(
                    child: Text(
                      widget.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: foreground,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.1,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A small round clay control, for back arrows and cart buttons on an image.
class ClayIconButton extends StatelessWidget {
  const ClayIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.size = 44,
    this.badge,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final double size;

  /// A count to show in the corner. Hidden when null or zero.
  final int? badge;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ClayCard(
          onTap: onPressed,
          radius: AppRadius.pill,
          padding: EdgeInsets.zero,
          shadows: AppShadows.subtle,
          child: SizedBox(
            height: size,
            width: size,
            child: Icon(icon, size: size * 0.45, color: AppColors.textDark),
          ),
        ),
        if (badge != null && badge! > 0)
          Positioned(
            top: -2,
            right: -2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              constraints: const BoxConstraints(minWidth: 19),
              decoration: BoxDecoration(
                color: AppColors.primaryMedium,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(color: AppColors.background, width: 2),
              ),
              child: Text(
                '${badge! > 99 ? '99+' : badge}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// A selectable pill - variety filters, weight options.
class ClayChip extends StatelessWidget {
  const ClayChip({
    super.key,
    required this.label,
    this.sublabel,
    this.selected = false,
    this.onTap,
    this.icon,
  });

  final String label;
  final String? sublabel;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? Colors.white : AppColors.textDark;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 170),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        color: selected ? AppColors.primaryMedium : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: selected ? AppShadows.accent : AppShadows.subtle,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.md),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: 16,
              vertical: sublabel == null ? 11 : 10,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 15, color: foreground),
                      const SizedBox(width: 6),
                    ],
                    Text(
                      label,
                      style: TextStyle(
                        color: foreground,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
                if (sublabel != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    sublabel!,
                    style: TextStyle(
                      color: selected
                          ? Colors.white.withValues(alpha: 0.85)
                          : AppColors.primaryMedium,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A short status word - "Best Seller", "Verified". Colour carries the meaning,
/// so it takes its own tone rather than the brand green by default.
class ClayBadge extends StatelessWidget {
  const ClayBadge({
    super.key,
    required this.label,
    this.icon,
    this.color = AppColors.primaryMedium,
    this.compact = false,
  });

  final String label;
  final IconData? icon;
  final Color color;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 9 : 12,
        vertical: compact ? 5 : 7,
      ),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.3),
            offset: const Offset(0, 4),
            blurRadius: 10,
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: compact ? 11 : 13, color: Colors.white),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              color: Colors.white,
              fontSize: compact ? 10.5 : 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.1,
            ),
          ),
        ],
      ),
    );
  }
}

/// Placeholder shown while real data is on its way. Shaped like the thing it
/// stands in for, so the screen does not jump when the content lands.
class ClaySkeleton extends StatefulWidget {
  const ClaySkeleton({
    super.key,
    this.height = 16,
    this.width,
    this.radius = AppRadius.sm,
  });

  final double height;
  final double? width;
  final double radius;

  @override
  State<ClaySkeleton> createState() => _ClaySkeletonState();
}

class _ClaySkeletonState extends State<ClaySkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.45, end: 0.9).animate(_controller),
      child: Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: AppColors.surfaceSunken,
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// Shown when a screen has nothing to show, or could not load. Both cases need
/// the same thing: say what happened, and offer the way out.
class ClayEmptyState extends StatelessWidget {
  const ClayEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 92,
              width: 92,
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                boxShadow: AppShadows.raised,
              ),
              child: Icon(icon, size: 38, color: AppColors.primaryLight),
            ),
            const SizedBox(height: 22),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.textDark,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                color: AppColors.textMuted,
                height: 1.5,
              ),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 24),
              ClayButton(
                label: actionLabel!,
                onPressed: onAction,
                expand: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
