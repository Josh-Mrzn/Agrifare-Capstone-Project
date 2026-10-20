import 'package:flutter/material.dart';

import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'change_password_screen.dart';
import 'welcome_screen.dart';

/// A rider's own account: their name as the shop and buyers see it, their
/// password, and signing out. Shop settings belong to the seller.
class RiderProfileScreen extends StatefulWidget {
  const RiderProfileScreen({super.key});

  @override
  State<RiderProfileScreen> createState() => _RiderProfileScreenState();
}

class _RiderProfileScreenState extends State<RiderProfileScreen> {
  final _name = TextEditingController();
  bool _saving = false;
  bool _filled = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Once: the field is the rider's to edit after that.
    if (!_filled) {
      _name.text = UserModel.of(context).account?.name ?? '';
      _filled = true;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _saveName() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      _notify('Enter your name.');
      return;
    }
    setState(() => _saving = true);
    try {
      final user = await AuthService.instance.updateName(name);
      if (!mounted) return;
      UserModel.of(context).applyAccount(user);
      _notify('Name saved.');
    } on ApiException catch (err) {
      if (mounted) _notify(err.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signOut() async {
    UserModel.of(context).clearAccount();
    await ApiClient.instance.clearToken();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const WelcomeScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final account = UserModel.of(context).account;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text('My account'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 32),
        children: [
          ClayCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(account?.email ?? '', style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted)),
                const SizedBox(height: 12),
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Your name', helperText: 'Shown to the shop and to buyers on your deliveries.'),
                ),
                const SizedBox(height: 12),
                ClayButton(label: 'Save name', isLoading: _saving, onPressed: _saving ? null : _saveName),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ClayButton(
            label: 'Change password',
            icon: Icons.lock_rounded,
            filled: false,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ChangePasswordScreen()),
            ),
          ),
          const SizedBox(height: 12),
          ClayButton(label: 'Sign out', icon: Icons.logout_rounded, filled: false, onPressed: _signOut),
        ],
      ),
    );
  }
}
