import 'package:flutter/material.dart';

import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'otp_verification_screen.dart';

/// Password changes go through email — same door as forgot-password.
/// Typing the current password here was redundant with that flow.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  bool _sending = false;
  bool _sent = false;

  Future<void> _sendLink() async {
    final email = UserModel.of(context).email.trim();
    if (email.isEmpty) {
      _notify('No email on this account.', ok: false);
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() => _sending = true);

    int? resendAfter;
    try {
      await AuthService.instance.forgotPassword(email);
    } on ApiException catch (err) {
      if (!mounted) return;
      // A code went out less than a minute ago and still works - open it.
      if (!err.isResendCooldown) {
        setState(() => _sending = false);
        _notify(err.message, ok: false);
        return;
      }
      resendAfter = err.retryAfter;
    }

    if (!mounted) return;
    setState(() {
      _sending = false;
      _sent = true;
    });

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OtpVerificationScreen(
          email: email,
          fullName: '',
          purpose: OtpPurpose.passwordReset,
          resendAfter: resendAfter,
        ),
      ),
    );
  }

  void _notify(String message, {required bool ok}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message, style: const TextStyle(fontSize: 13)),
          backgroundColor:
              ok ? AppColors.primaryMedium : AppColors.primaryDark,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          margin: const EdgeInsets.all(16),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final email = UserModel.of(context).email;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
          child: ClayIconButton(
            icon: Icons.arrow_back_rounded,
            size: 38,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ),
        leadingWidth: 62,
        title: const Text('Change Password'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              Center(
                child: Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    shape: BoxShape.circle,
                    boxShadow: AppShadows.raised,
                  ),
                  child: const Icon(
                    Icons.mark_email_unread_outlined,
                    size: 36,
                    color: AppColors.primaryDark,
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                _sent ? 'Check your email' : 'Reset via email',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _sent
                    ? 'We sent a 6-digit code to your inbox. Enter it on the next screen to set a new password.'
                    : 'We will send a reset code to your account email. No need to type your current password here.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textMuted,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 28),
              ClayCard(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                shadows: AppShadows.subtle,
                child: Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSunken,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0x17122112),
                          width: 1,
                        ),
                      ),
                      child: const Icon(
                        Icons.mail_outline_rounded,
                        size: 20,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Account email',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.textMuted,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            email.isEmpty ? 'Not available' : email,
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textDark,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              ClayButton(
                label: _sent ? 'Send code again' : 'Send reset link',
                icon: Icons.send_rounded,
                isLoading: _sending,
                onPressed: _sending ? null : _sendLink,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
