import 'package:flutter/material.dart';

import '../models/notification_model.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/rider_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'notifications_screen.dart';
import 'rider_delivery_screen.dart';
import 'rider_profile_screen.dart';

/// What a delivery rider sees instead of a shop.
///
/// A rider has no cart and nothing to browse. Their app is the list of
/// things to carry - new ones to accept, ones to pick up, ones on the road -
/// and, under Delivered, what they have already brought. Each opens the
/// delivery itself, with the map, the route and the buttons for each step.
class RiderHomeScreen extends StatefulWidget {
  const RiderHomeScreen({super.key});

  @override
  State<RiderHomeScreen> createState() => _RiderHomeScreenState();
}

class _RiderHomeScreenState extends State<RiderHomeScreen> {
  bool _history = false;
  List<Delivery> _deliveries = const [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    // The bell's count, so a new assignment shows without opening anything.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) NotificationModel.of(context).load();
    });
  }

  Future<void> _load() async {
    try {
      final deliveries = await RiderService.instance.myDeliveries(history: _history);
      if (!mounted) return;
      setState(() {
        _deliveries = deliveries;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  void _switch(bool history) {
    if (history == _history) return;
    setState(() {
      _history = history;
      _loading = true;
    });
    _load();
  }

  Future<void> _open(Delivery delivery) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => RiderDeliveryScreen(orderId: delivery.orderId)),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final name = UserModel.of(context).account?.name ?? 'Rider';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _header(name),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 10),
              child: Row(
                children: [
                  ClayChip(label: 'To do', selected: !_history, onTap: () => _switch(false)),
                  const SizedBox(width: 8),
                  ClayChip(label: 'Delivered', selected: _history, onTap: () => _switch(true)),
                ],
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _header(String name) {
    final waiting = _deliveries.where((d) => d.isWaitingForAnswer).length;

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'DELIVERIES',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.7,
                    color: AppColors.textDark,
                  ),
                ),
                if (!_loading && !_history)
                  Text(
                    _deliveries.isEmpty
                        ? 'Nothing waiting'
                        : waiting > 0
                            ? '$waiting new to accept, ${_deliveries.length} in all'
                            : '${_deliveries.length} to deliver',
                    style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted),
                  ),
              ],
            ),
          ),
          ClayIconButton(
            icon: Icons.notifications_rounded,
            size: 40,
            badge: NotificationModel.of(context).unreadCount,
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NotificationsScreen()),
              );
              if (mounted) _load();
            },
          ),
          const SizedBox(width: 8),
          ClayIconButton(
            icon: Icons.person_rounded,
            size: 40,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const RiderProfileScreen()),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 20),
        children: const [
          ClaySkeleton(height: 150, radius: AppRadius.lg),
          SizedBox(height: 12),
          ClaySkeleton(height: 150, radius: AppRadius.lg),
        ],
      );
    }

    if (_error != null) {
      return ClayEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Could not load your deliveries',
        message: _error!,
        actionLabel: 'Try again',
        onAction: _load,
      );
    }

    if (_deliveries.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primaryMedium,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.12),
            ClayEmptyState(
              icon: Icons.local_shipping_outlined,
              title: _history ? 'Nothing delivered yet' : 'Nothing assigned yet',
              message: _history
                  ? 'Deliveries you finish are listed here.'
                  : 'Your shop sends you deliveries here to accept. Pull down to check again.',
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primaryMedium,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: _deliveries.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, i) => _DeliveryTile(
          delivery: _deliveries[i],
          onTap: () => _open(_deliveries[i]),
        ),
      ),
    );
  }
}

/// The badge text and colour for where a delivery stands, for the rider.
(String, Color) deliveryStage(Delivery d) {
  if (d.isDone) return ('Delivered', AppColors.success);
  if (d.isWaitingForAnswer) return ('New: accept or decline', AppColors.accent);
  if (d.isOnTheWay) return ('On the way', AppColors.primaryMedium);
  if (d.status == 'processing') return ('Ready to pick up', AppColors.primaryMedium);
  return ('Being prepared', AppColors.textMuted);
}

class _DeliveryTile extends StatelessWidget {
  const _DeliveryTile({required this.delivery, required this.onTap});

  final Delivery delivery;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final d = delivery;
    final (label, color) = deliveryStage(d);

    return ClayCard(
      padding: const EdgeInsets.all(15),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  d.orderNumber,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textDark,
                  ),
                ),
              ),
              ClayBadge(label: label, color: color, compact: true),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            d.summary,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12.5, height: 1.35, color: AppColors.textMuted),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.home_rounded, size: 15, color: AppColors.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${d.customerName} · ${d.dropoff.address}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textBody),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(
                d.collectsCash ? Icons.payments_rounded : Icons.check_circle_rounded,
                size: 15,
                color: d.collectsCash ? AppColors.warning : AppColors.success,
              ),
              const SizedBox(width: 6),
              Text(
                d.collectsCash
                    ? 'Collect ₱${d.amountToCollect.toStringAsFixed(2)} cash'
                    : d.isDone && d.cashCollected != null
                        ? 'Collected ₱${d.cashCollected!.toStringAsFixed(2)}'
                        : 'Already paid, collect nothing',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: d.collectsCash ? AppColors.warning : AppColors.textBody,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
