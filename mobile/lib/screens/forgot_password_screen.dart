import 'package:flutter/material.dart';

import '../theme/portal_theme.dart';
import '../widgets/auth_scaffold.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import 'otp_verification_screen.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _isLoading = false;
  bool _emailSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _handleSendLink() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();

    final email = _emailController.text.trim();
    setState(() => _isLoading = true);

    int? resendAfter;
    try {
      await AuthService.instance.forgotPassword(email);
    } on ApiException catch (err) {
      if (!mounted) return;
      // Asked again within the minute: the code already sent still works, so
      // go to it rather than stopping here with an error.
      if (err.isResendCooldown) {
        resendAfter = err.retryAfter;
      } else {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(err.message),
              behavior: SnackBarBehavior.floating,
              duration: const Duration(seconds: 4),
            ),
          );
        return;
      }
    }

    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _emailSent = true;
    });

    Navigator.of(context).push(
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

  @override
  Widget build(BuildContext context) {
    final sent = _emailSent;

    return AuthScaffold(
      label: 'Password Reset',
      title: sent ? 'Check your email.' : 'Forgot password?',
      subtitle: sent
          ? 'We sent a 6-digit code. It is good for a few minutes.'
          : 'Enter the email on your account and we will send a reset code.',
      onBack: () => Navigator.of(context).maybePop(),
      children: [
        sent ? _buildSuccessState() : _buildFormState(),
      ],
    );
  }

  Widget _buildFormState() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Email address',
          style: portalBody(
            size: 12.5,
            weight: FontWeight.w700,
            color: PortalColors.textDark,
          ),
        ),
        const SizedBox(height: 8),
        Form(
          key: _formKey,
          child: TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            enabled: !_isLoading,
            onFieldSubmitted: (_) => _handleSendLink(),
            style: portalBody(size: 15, color: PortalColors.textDark),
            decoration: const InputDecoration(
              hintText: 'you@email.com',
              prefixIcon: AuthFieldPrefix('ID'),
              prefixIconConstraints: BoxConstraints(minWidth: 0, minHeight: 0),
            ),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Please enter your email';
              if (!RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(v)) {
                return 'Enter a valid email address';
              }
              return null;
            },
          ),
        ),
        const SizedBox(height: 22),
        AuthButton(
          label: 'Send reset code',
          icon: Icons.send_rounded,
          onPressed: _isLoading ? null : _handleSendLink,
          isLoading: _isLoading,
        ),
      ],
    );
  }

  Widget _buildSuccessState() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: PortalColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0x29122112)),
          ),
          child: Column(
            children: [
              Container(
                height: 64,
                width: 64,
                decoration: BoxDecoration(
                  color: PortalColors.gold.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.mark_email_read_outlined,
                  size: 30,
                  color: PortalColors.primaryMedium,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Code on the way',
                textAlign: TextAlign.center,
                style: portalDisplay(size: 22),
              ),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  style: portalBody(
                    size: 14,
                    color: PortalColors.textMuted,
                    height: 1.5,
                  ),
                  children: [
                    const TextSpan(text: 'We sent a reset code to\n'),
                    TextSpan(
                      text: _emailController.text.trim(),
                      style: portalBody(
                        size: 14,
                        weight: FontWeight.w700,
                        color: PortalColors.primaryMedium,
                      ),
                    ),
                  ],
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        AuthButton(
          label: 'Back to Sign In',
          onPressed: () => Navigator.of(context).pop(),
        ),
        const SizedBox(height: 12),
        Center(
          child: TextButton(
            onPressed: () => setState(() => _emailSent = false),
            child: Text(
              'Try a different email',
              style: portalBody(
                size: 14,
                weight: FontWeight.w700,
                color: PortalColors.primaryMedium,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
