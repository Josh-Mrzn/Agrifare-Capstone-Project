import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/cart.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/order_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'addresses_screen.dart';
import 'change_password_screen.dart';
import 'info_screens.dart';
import 'orders_screen.dart';
import 'sign_in_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => ProfileScreenState();
}

class ProfileScreenState extends State<ProfileScreen> {
  int _orderCount = 0;
  double _totalSpent = 0;
  int _memberSinceYear = DateTime.now().year;
  bool _loadingStats = true;

  @override
  void initState() {
    super.initState();
    reloadStats();
  }

  /// Refreshed when the Profile tab is opened — same idea as Messages.
  Future<void> reloadStats() async {
    try {
      final orders = await OrderService.instance.myOrders();
      // Cancelled checkouts never left the wallet.
      final spent = orders
          .where((o) => o.status != 'cancelled')
          .fold<double>(0, (sum, o) => sum + o.total);

      var year = DateTime.now().year;
      for (final order in orders) {
        final dated = order.orderDate;
        if (dated != null && dated.year < year) year = dated.year;
      }

      if (!mounted) return;
      setState(() {
        _orderCount = orders.length;
        _totalSpent = spent;
        _memberSinceYear = year;
        _loadingStats = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() => _loadingStats = false);
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingStats = false);
    }
  }

  Future<void> _openOrders() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const OrdersScreen()),
    );
    if (mounted) reloadStats();
  }

  @override
  Widget build(BuildContext context) {
    final user = UserModel.of(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.primaryMedium,
          onRefresh: reloadStats,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(0, 8, 0, 28),
            child: Column(
              children: [
                _ProfileHeader(
                  user: user,
                  orderCount: _orderCount,
                  totalSpent: _totalSpent,
                  memberSinceYear: _memberSinceYear,
                  loadingStats: _loadingStats,
                ),
                const SizedBox(height: 8),
                _buildSection('Account Information', [
                  _MenuItem(
                    icon: Icons.lock_outline_rounded,
                    label: 'Change Password',
                    subtitle: 'Send a reset link to your email',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ChangePasswordScreen(),
                      ),
                    ),
                  ),
                ]),
                _buildSection('My Orders', [
                  _MenuItem(
                    icon: Icons.receipt_long_outlined,
                    label: 'My Orders',
                    subtitle: 'To pay, to ship, to receive, to review',
                    onTap: _openOrders,
                  ),
                  _MenuItem(
                    icon: Icons.location_on_outlined,
                    label: 'My Addresses',
                    subtitle: 'Where your orders are delivered',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AddressesScreen(),
                      ),
                    ),
                  ),
                ]),
                _buildSection('Support', [
                  _MenuItem(
                    icon: Icons.policy_outlined,
                    label: 'Policy & Privacy',
                    subtitle: 'How AgriFair uses your information',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const PolicyPrivacyScreen(),
                      ),
                    ),
                  ),
                  _MenuItem(
                    icon: Icons.info_outline_rounded,
                    label: 'About System',
                    subtitle: 'What this app is and how it works',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AboutSystemScreen(),
                      ),
                    ),
                  ),
                ]),
                _buildSection('Account', [
                  _MenuItem(
                    icon: Icons.logout_rounded,
                    label: 'Sign Out',
                    subtitle: user.email,
                    iconColor: AppColors.error,
                    labelColor: AppColors.error,
                    onTap: () => _handleSignOut(context),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static Widget _buildSection(String title, List<Widget> children) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 6, 4, 10),
            child: Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppColors.textMuted,
                letterSpacing: 1.2,
              ),
            ),
          ),
          ClayCard(
            padding: EdgeInsets.zero,
            radius: AppRadius.lg,
            shadows: AppShadows.subtle,
            child: Column(
              children: [
                for (int i = 0; i < children.length; i++) ...[
                  children[i],
                  if (i < children.length - 1)
                    const Divider(
                      height: 1,
                      color: Color(0x17122112),
                      indent: 70,
                      endIndent: 16,
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _handleSignOut(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
        title: const Text(
          'Sign Out',
          style: TextStyle(
            color: AppColors.textDark,
            fontWeight: FontWeight.w700,
            fontSize: 18,
          ),
        ),
        content: const Text(
          'Are you sure you want to sign out?',
          style: TextStyle(color: AppColors.textMuted, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Cancel',
              style: TextStyle(color: AppColors.textMuted),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              UserModel.of(context).reset();
              CartModel.of(context).clear();
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const SignInScreen()),
                (route) => false,
              );
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
            ),
            child: const Text(
              'Sign Out',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Sub-widgets ───────────────────────────────────────────────────────────────

class _ProfileHeader extends StatelessWidget {
  final UserModel user;
  final int orderCount;
  final double totalSpent;
  final int memberSinceYear;
  final bool loadingStats;

  const _ProfileHeader({
    required this.user,
    required this.orderCount,
    required this.totalSpent,
    required this.memberSinceYear,
    required this.loadingStats,
  });

  static String _formatSpent(double amount) {
    final whole = amount == amount.roundToDouble();
    final digits = whole ? amount.toInt().toString() : amount.toStringAsFixed(2);
    final parts = digits.split('.');
    final buffer = StringBuffer();
    final chars = parts[0].split('').reversed.toList();
    for (var i = 0; i < chars.length; i++) {
      if (i > 0 && i % 3 == 0) buffer.write(',');
      buffer.write(chars[i]);
    }
    final grouped = buffer.toString().split('').reversed.join();
    if (parts.length > 1) return '₱$grouped.${parts[1]}';
    return '₱$grouped';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
      child: Column(
        children: [
          const Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'My Profile',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: AppColors.textDark,
                letterSpacing: -0.6,
              ),
            ),
          ),
          const SizedBox(height: 22),
          GestureDetector(
            onTap: () => _showAvatarSheet(context, user),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: AppColors.primaryDark,
                    shape: BoxShape.circle,
                    boxShadow: AppShadows.raised,
                  ),
                  child: ClipOval(
                    child: user.profileImagePath.isNotEmpty
                        ? Image.file(
                            File(user.profileImagePath),
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                _AvatarLetter(letter: user.avatarLetter),
                          )
                        : _AvatarLetter(letter: user.avatarLetter),
                  ),
                ),
                Positioned(
                  bottom: 2,
                  right: 2,
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: AppColors.background,
                        width: 3,
                      ),
                      boxShadow: AppShadows.subtle,
                    ),
                    child: const Icon(
                      Icons.camera_alt_rounded,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            user.displayName,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textDark,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            user.email,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13.5,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 20),
          ClayCard(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
            radius: AppRadius.lg,
            shadows: AppShadows.subtle,
            child: Row(
              children: [
                _StatBox(
                  label: 'Orders',
                  value: loadingStats ? '—' : '$orderCount',
                  icon: Icons.receipt_rounded,
                ),
                Container(
                  width: 1,
                  height: 40,
                  color: const Color(0x17122112),
                ),
                _StatBox(
                  label: 'Total Spent',
                  value: loadingStats ? '—' : _formatSpent(totalSpent),
                  icon: Icons.payments_outlined,
                ),
                Container(
                  width: 1,
                  height: 40,
                  color: const Color(0x17122112),
                ),
                _StatBox(
                  label: 'Member Since',
                  value: loadingStats ? '—' : '$memberSinceYear',
                  icon: Icons.calendar_month_outlined,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AvatarLetter extends StatelessWidget {
  final String letter;
  const _AvatarLetter({required this.letter});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.primaryDark,
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          fontSize: 36,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
  }
}

Future<void> _showAvatarSheet(BuildContext context, UserModel user) async {
  final hasImage = user.profileImagePath.isNotEmpty;
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetCtx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSunken,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Profile Photo',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Update your profile picture',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: AppColors.textMuted),
              ),
              const SizedBox(height: 18),
              _SheetAction(
                icon: Icons.photo_camera_outlined,
                label: 'Take Photo',
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  await _pickAndApply(context, user, ImageSource.camera);
                },
              ),
              const SizedBox(height: 10),
              _SheetAction(
                icon: Icons.photo_library_outlined,
                label: 'Choose from Gallery',
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  await _pickAndApply(context, user, ImageSource.gallery);
                },
              ),
              if (hasImage) ...[
                const SizedBox(height: 10),
                _SheetAction(
                  icon: Icons.delete_outline_rounded,
                  label: 'Remove Photo',
                  isDestructive: true,
                  onTap: () {
                    Navigator.pop(sheetCtx);
                    user.updateProfile(profileImagePath: '');
                  },
                ),
              ],
              const SizedBox(height: 8),
            ],
          ),
        ),
      );
    },
  );
}

Future<void> _pickAndApply(
  BuildContext context,
  UserModel user,
  ImageSource source,
) async {
  try {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 85,
    );
    if (file == null) return;
    user.updateProfile(profileImagePath: file.path);
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not load image: $e')),
    );
  }
}

class _SheetAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool isDestructive;

  const _SheetAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.isDestructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = isDestructive ? AppColors.error : AppColors.primaryDark;
    return ClayCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      radius: AppRadius.md,
      shadows: AppShadows.subtle,
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 12),
          Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _StatBox({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.surfaceSunken,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: const Color(0x17122112), width: 1),
            ),
            child: Icon(icon, size: 18, color: AppColors.primaryMedium),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              color: AppColors.textMuted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final Color? iconColor;
  final Color? labelColor;
  final VoidCallback onTap;

  const _MenuItem({
    required this.icon,
    required this.label,
    required this.subtitle,
    this.iconColor,
    this.labelColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final accent = iconColor ?? AppColors.primaryDark;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppColors.surfaceSunken,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0x17122112), width: 1),
              ),
              child: Icon(icon, size: 20, color: accent),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: labelColor ?? AppColors.textDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppColors.textMuted,
              size: 22,
            ),
          ],
        ),
      ),
    );
  }
}
