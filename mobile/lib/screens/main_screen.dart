import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../services/chat_service.dart';
import '../theme/app_theme.dart';
import 'chat_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'shop_screen.dart';

/// Four places, each answering a different question: what rice is there, who
/// sells it, who am I talking to, and what have I bought.
///
/// Orders used to sit here as a fifth tab. They belong under Profile - a
/// buyer looks for their orders where their account is, and a tab bar with
/// five entries makes every one of them harder to hit.
class MainScreen extends StatefulWidget {
  const MainScreen({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  late int _tab = widget.initialTab;
  int _unread = 0;

  /// Reaches the Messages tab, which an IndexedStack builds once and then
  /// keeps - so it has to be told when to look again.
  final _chatKey = GlobalKey<ChatScreenState>();
  final _profileKey = GlobalKey<ProfileScreenState>();

  @override
  void initState() {
    super.initState();
    _loadUnread();
  }

  static const _tabs = [
    _TabSpec(Icons.home_rounded, Icons.home_outlined, 'Home'),
    _TabSpec(Icons.storefront_rounded, Icons.storefront_outlined, 'Shop'),
    _TabSpec(
      Icons.chat_bubble_rounded,
      Icons.chat_bubble_outline_rounded,
      'Messages',
    ),
    _TabSpec(Icons.person_rounded, Icons.person_outline_rounded, 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      // Kept alive so scroll position and loaded data survive tab switches -
      // rebuilding the catalog every time Home is tapped refetches for nothing.
      body: IndexedStack(
        index: _tab,
        children: [
          const HomeScreen(),
          const ShopScreen(),
          ChatScreen(key: _chatKey),
          ProfileScreen(key: _profileKey),
        ],
      ),
      bottomNavigationBar: _navBar(),
    );
  }

  Widget _navBar() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
        boxShadow: [
          BoxShadow(
            color: Color(0x17122112),
            offset: Offset(0, -6),
            blurRadius: 18,
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Row(
            children: [
              for (var i = 0; i < _tabs.length; i++)
                Expanded(
                  child: _NavItem(
                    spec: _tabs[i],
                    selected: _tab == i,
                    badge: i == 2 ? _unread : 0,
                    onTap: () {
                      setState(() => _tab = i);

                      if (i == 2) {
                        // Opening Messages: read it again. The screen was
                        // built at launch and has not looked since.
                        _chatKey.currentState?.reload();
                      } else {
                        // Leaving Messages is when the count has most likely
                        // just changed.
                        _loadUnread();
                        if (i == 3) {
                          _profileKey.currentState?.reloadStats();
                        }
                      }
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Refreshed when the tab bar is built rather than polled: opening the app
  /// or coming back to it is when the number matters, and a chat app that
  /// polls in the background is a battery complaint waiting to happen.
  Future<void> _loadUnread() async {
    try {
      final conversations = await ChatService.instance.conversations();
      if (!mounted) return;

      final total = conversations.fold<int>(0, (sum, c) => sum + c.unreadCount);
      if (total != _unread) setState(() => _unread = total);
    } on ApiException {
      // A badge is not worth an error on screen.
    }
  }
}

class _TabSpec {
  const _TabSpec(this.active, this.inactive, this.label);

  final IconData active;
  final IconData inactive;
  final String label;
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.spec,
    required this.selected,
    required this.onTap,
    this.badge = 0,
  });

  final _TabSpec spec;
  final bool selected;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.primaryMedium : AppColors.textMuted;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // The selected tab sits on a raised pill, so which one is active
            // reads at a glance rather than from colour alone.
            AnimatedContainer(
              duration: const Duration(milliseconds: 190),
              curve: Curves.easeOut,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
              decoration: BoxDecoration(
                color: selected ? AppColors.surfaceSunken : Colors.transparent,
                borderRadius: BorderRadius.circular(AppRadius.pill),
              ),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(selected ? spec.active : spec.inactive, size: 23, color: color),
                  if (badge > 0)
                    Positioned(
                      top: -4,
                      right: -7,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        constraints: const BoxConstraints(minWidth: 17),
                        decoration: BoxDecoration(
                          color: AppColors.error,
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                          border: Border.all(color: AppColors.surface, width: 1.5),
                        ),
                        child: Text(
                          badge > 99 ? '99+' : '$badge',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Text(
              spec.label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
