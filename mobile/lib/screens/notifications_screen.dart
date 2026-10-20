import 'package:flutter/material.dart';

import '../models/notification_model.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'chat_screen.dart';
import 'order_detail_screen.dart';
import 'orders_screen.dart';
import 'rider_delivery_screen.dart';
import '../services/api_client.dart';
import '../services/order_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      NotificationModel.of(context).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final nm = NotificationModel.of(context);
    final all = nm.notifications;

    final now = DateTime.now();
    final todayDate = DateTime(now.year, now.month, now.day);
    final yesterdayDate = todayDate.subtract(const Duration(days: 1));

    bool isToday(DateTime dt) =>
        DateTime(dt.year, dt.month, dt.day) == todayDate;
    bool isYesterday(DateTime dt) =>
        DateTime(dt.year, dt.month, dt.day) == yesterdayDate;

    final today = all.where((n) => isToday(n.timestamp)).toList();
    final yesterday = all.where((n) => isYesterday(n.timestamp)).toList();
    final earlier = all
        .where((n) => !isToday(n.timestamp) && !isYesterday(n.timestamp))
        .toList();

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
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Notifications'),
            if (nm.unreadCount > 0)
              Text(
                '${nm.unreadCount} unread',
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.primaryMedium,
                  fontWeight: FontWeight.w600,
                ),
              ),
          ],
        ),
        actions: [
          if (nm.unreadCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: TextButton(
                onPressed: nm.markAllRead,
                child: const Text(
                  'Mark all read',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark,
                  ),
                ),
              ),
            ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primaryMedium,
        onRefresh: nm.load,
        child: nm.loading && all.isEmpty
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 160),
                  Center(
                    child: CircularProgressIndicator(
                      color: AppColors.primaryMedium,
                    ),
                  ),
                ],
              )
            : nm.error != null && all.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(32),
                    children: [
                      const SizedBox(height: 80),
                      ClayEmptyState(
                        icon: Icons.wifi_off_rounded,
                        title: 'Could not load',
                        message: nm.error!,
                        actionLabel: 'Try again',
                        onAction: nm.load,
                      ),
                    ],
                  )
                : all.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          SizedBox(height: 48),
                          _EmptyNotifications(),
                        ],
                      )
                    : ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
                        children: [
                          if (today.isNotEmpty) ...[
                            _SectionHeader(
                              label: 'Today',
                              count: today.where((n) => !n.isRead).length,
                            ),
                            ...today.map(
                              (n) => _NotificationCard(notification: n),
                            ),
                          ],
                          if (yesterday.isNotEmpty) ...[
                            _SectionHeader(
                              label: 'Yesterday',
                              count: yesterday.where((n) => !n.isRead).length,
                            ),
                            ...yesterday.map(
                              (n) => _NotificationCard(notification: n),
                            ),
                          ],
                          if (earlier.isNotEmpty) ...[
                            _SectionHeader(
                              label: 'Earlier',
                              count: earlier.where((n) => !n.isRead).length,
                            ),
                            ...earlier.map(
                              (n) => _NotificationCard(notification: n),
                            ),
                          ],
                        ],
                      ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label, required this.count});

  final String label;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
      child: Row(
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.textMuted,
              letterSpacing: 1.0,
            ),
          ),
          if (count > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primaryMedium,
                borderRadius: BorderRadius.circular(AppRadius.pill),
              ),
              child: Text(
                '$count',
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.notification});

  final AppNotification notification;

  Future<void> _handleTap(BuildContext context) async {
    await NotificationModel.of(context).markRead(notification.id);
    if (!context.mounted) return;

    // The server writes each link for the app its reader uses:
    // /orders/<groupId>, /messages/<conversationId>, /rider?order=<id>.
    final link = Uri.tryParse(notification.link);
    final segments = link?.pathSegments ?? const <String>[];

    if (segments.length == 2 && segments.first == 'orders') {
      try {
        final order = await OrderService.instance.byGroupId(segments[1]);
        if (!context.mounted) return;
        Navigator.push(context, MaterialPageRoute(builder: (_) => OrderDetailScreen(order: order)));
        return;
      } on ApiException {
        // Fall through to the list, which still shows it.
      }
    }
    if (segments.isNotEmpty && segments.first == 'rider') {
      final orderId = link?.queryParameters['order'];
      if (orderId != null && orderId.isNotEmpty) {
        if (!context.mounted) return;
        Navigator.push(context, MaterialPageRoute(builder: (_) => RiderDeliveryScreen(orderId: orderId)));
        return;
      }
    }
    if (!context.mounted) return;

    switch (notification.type) {
      case NotificationType.order:
      case NotificationType.payment:
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const OrdersScreen()),
        );
        return;
      case NotificationType.message:
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ChatScreen()),
        );
        return;
      case NotificationType.stock:
      case NotificationType.system:
        return;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isUnread = !notification.isRead;
    final color = _typeColor(notification.type);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ClayCard(
        onTap: () => _handleTap(context),
        padding: const EdgeInsets.all(14),
        shadows: AppShadows.subtle,
        color: isUnread ? const Color(0xFFF6F2E6) : AppColors.surface,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: AppColors.surfaceSunken,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0x17122112), width: 1),
              ),
              child: Icon(_typeIcon(notification.type), size: 21, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          notification.title,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight:
                                isUnread ? FontWeight.w700 : FontWeight.w600,
                            color: AppColors.textDark,
                            height: 1.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            _relativeTime(notification.timestamp),
                            style: TextStyle(
                              fontSize: 10,
                              color: isUnread
                                  ? AppColors.primaryMedium
                                  : AppColors.textMuted,
                              fontWeight: isUnread
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                          if (isUnread) ...[
                            const SizedBox(height: 4),
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: AppColors.primaryMedium,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                  if (notification.body.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      notification.body,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.textMuted,
                        height: 1.5,
                      ),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (_hasNavigation(notification.type)) ...[
                    const SizedBox(height: 8),
                    Text(
                      _navHintLabel(notification.type),
                      style: TextStyle(
                        fontSize: 11.5,
                        color: color,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _typeIcon(NotificationType type) => switch (type) {
        NotificationType.order => Icons.receipt_long_rounded,
        NotificationType.payment => Icons.payments_rounded,
        NotificationType.message => Icons.chat_bubble_rounded,
        NotificationType.stock => Icons.inventory_2_rounded,
        NotificationType.system => Icons.info_outline_rounded,
      };

  Color _typeColor(NotificationType type) => switch (type) {
        NotificationType.order => AppColors.primaryMedium,
        NotificationType.payment => const Color(0xFF2F6F5E),
        NotificationType.message => AppColors.primaryDark,
        NotificationType.stock => AppColors.warning,
        NotificationType.system => AppColors.textMuted,
      };

  bool _hasNavigation(NotificationType type) =>
      type == NotificationType.order ||
      type == NotificationType.payment ||
      type == NotificationType.message;

  String _navHintLabel(NotificationType type) => switch (type) {
        NotificationType.message => 'Open Messages →',
        NotificationType.order || NotificationType.payment => 'View Orders →',
        _ => '',
      };

  String _relativeTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'Yesterday';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}';
  }
}

class _EmptyNotifications extends StatelessWidget {
  const _EmptyNotifications();

  @override
  Widget build(BuildContext context) {
    return const ClayEmptyState(
      icon: Icons.notifications_none_rounded,
      title: 'No notifications',
      message:
          'Order updates, payments, and messages from AgriFair will show up here when there is something new.',
    );
  }
}
