import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/order.dart';
import '../services/api_client.dart';
import '../services/order_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import 'order_detail_screen.dart';

/// Every order this buyer has placed, split by the stage it is at.
///
/// One fetch feeds all six tabs. They are views of the same list, so
/// refetching per tab would make switching feel slower than it is.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({
    super.key,
    this.initialStage = OrderStage.all,
    this.stages = OrderStage.statusTabs,
  });

  final OrderStage initialStage;

  /// Which tabs to show: the step-by-step ones, or Ongoing and History.
  final List<OrderStage> stages;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(
    length: widget.stages.length,
    vsync: this,
    initialIndex: widget.stages.contains(widget.initialStage)
        ? widget.stages.indexOf(widget.initialStage)
        : 0,
  );

  List<OrderGroup> _orders = const [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final orders = await OrderService.instance.myOrders();
      if (!mounted) return;
      setState(() {
        _orders = orders;
        _loading = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  List<OrderGroup> _forStage(OrderStage stage) =>
      _orders.where((o) => stage.matches(o.status)).toList();

  int _countFor(OrderStage stage) =>
      stage == OrderStage.all ? _orders.length : _forStage(stage).length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
          child: ClayIconButton(
            icon: Icons.arrow_back_rounded,
            size: 38,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ),
        leadingWidth: 62,
        title: const Text('My Orders'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: TabBar(
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: AppColors.primaryMedium,
            indicatorWeight: 2.5,
            indicatorSize: TabBarIndicatorSize.label,
            labelColor: AppColors.primaryMedium,
            unselectedLabelColor: AppColors.textMuted,
            dividerColor: Colors.transparent,
            labelStyle: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
            ),
            unselectedLabelStyle: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w500,
            ),
            tabs: [
              for (final stage in widget.stages)
                Tab(
                  height: 46,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(stage.label),
                      // A count only helps where there is something waiting;
                      // a row of zeroes is noise.
                      if (!_loading && _countFor(stage) > 0) ...[
                        const SizedBox(width: 5),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSunken,
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                          ),
                          child: Text(
                            '${_countFor(stage)}',
                            style: const TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textBody,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      body: _error != null
          ? ClayEmptyState(
              icon: Icons.wifi_off_rounded,
              title: 'Cannot load your orders',
              message: _error!,
              actionLabel: 'Try again',
              onAction: _load,
            )
          : TabBarView(
              controller: _tabs,
              children: [
                for (final stage in widget.stages) _tabBody(stage),
              ],
            ),
    );
  }

  Widget _tabBody(OrderStage stage) {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        children: const [
          ClaySkeleton(height: 132, radius: AppRadius.lg),
          SizedBox(height: 12),
          ClaySkeleton(height: 132, radius: AppRadius.lg),
        ],
      );
    }

    final orders = _forStage(stage);

    if (orders.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primaryMedium,
        child: ListView(
          // Needs to scroll even when empty, or pull-to-refresh has nothing
          // to grab.
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.12),
            ClayEmptyState(
              icon: _emptyIcon(stage),
              title: _emptyTitle(stage),
              message: _emptyMessage(stage),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primaryMedium,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: orders.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, i) => _OrderCard(
          order: orders[i],
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => OrderDetailScreen(order: orders[i]),
              ),
            );
            // A cancellation on the detail screen changes which tab this
            // order belongs to, so the list is refreshed on the way back.
            if (mounted) _load();
          },
        ),
      ),
    );
  }

  IconData _emptyIcon(OrderStage stage) {
    switch (stage) {
      case OrderStage.toPay:
        return Icons.payments_outlined;
      case OrderStage.toShip:
        return Icons.inventory_2_outlined;
      case OrderStage.toReceive:
        return Icons.local_shipping_outlined;
      case OrderStage.toReview:
        return Icons.rate_review_outlined;
      case OrderStage.returned:
        return Icons.assignment_return_outlined;
      case OrderStage.all:
      case OrderStage.history:
        return Icons.receipt_long_outlined;
      case OrderStage.ongoing:
        return Icons.local_shipping_outlined;
    }
  }

  String _emptyTitle(OrderStage stage) {
    switch (stage) {
      case OrderStage.all:
        return 'No orders yet';
      case OrderStage.toPay:
        return 'Nothing waiting to be paid';
      case OrderStage.toShip:
        return 'Nothing being prepared';
      case OrderStage.toReceive:
        return 'Nothing on the way';
      case OrderStage.toReview:
        return 'Nothing to review';
      case OrderStage.returned:
        return 'No cancelled orders';
      case OrderStage.ongoing:
        return 'No ongoing orders';
      case OrderStage.history:
        return 'No past orders yet';
    }
  }

  String _emptyMessage(OrderStage stage) {
    switch (stage) {
      case OrderStage.all:
        return 'Your orders will show up here once you buy something.';
      case OrderStage.toPay:
        return 'Orders appear here while the seller is confirming them.';
      case OrderStage.toShip:
        return 'Once a seller confirms your order, it moves here.';
      case OrderStage.toReceive:
        return 'Orders on their way to you appear here.';
      case OrderStage.toReview:
        return 'After an order arrives, you can tell others how it was.';
      case OrderStage.returned:
        return 'Orders you or the seller called off appear here.';
      case OrderStage.ongoing:
        return 'Orders being confirmed, prepared or delivered appear here.';
      case OrderStage.history:
        return 'Completed and cancelled orders are kept here.';
    }
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order, required this.onTap});

  final OrderGroup order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ClayCard(
      onTap: onTap,
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  order.orderNumber,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textMuted,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
              ClayBadge(
                label: order.statusLabel,
                color: _statusColor(order.status),
                compact: true,
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (order.items.isNotEmpty) _itemRow(order.items.first),
          if (order.items.length > 1) ...[
            const SizedBox(height: 6),
            Text(
              '+ ${order.items.length - 1} more '
              '${order.items.length - 1 == 1 ? 'item' : 'items'}',
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
          const SizedBox(height: 13),
          const Divider(height: 1),
          const SizedBox(height: 11),
          Row(
            children: [
              Text(
                '${order.itemCount} ${order.itemCount == 1 ? 'item' : 'items'}',
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textMuted,
                ),
              ),
              const Spacer(),
              const Text(
                'Total  ',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
              Text(
                '₱${order.total.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                  letterSpacing: -0.4,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _itemRow(OrderItem item) {
    return Row(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: SizedBox(
            height: 52,
            width: 52,
            child: item.imageUrl.isEmpty
                ? Container(
                    color: AppColors.surfaceSunken,
                    child: const Icon(
                      Icons.rice_bowl_outlined,
                      size: 22,
                      color: AppColors.primaryLight,
                    ),
                  )
                : CachedNetworkImage(
                    imageUrl: item.imageUrl,
                    fit: BoxFit.cover,
                    errorWidget: (_, _, _) => Container(
                      color: AppColors.surfaceSunken,
                      child: const Icon(
                        Icons.rice_bowl_outlined,
                        size: 22,
                        color: AppColors.primaryLight,
                      ),
                    ),
                    placeholder: (_, _) =>
                        const ClaySkeleton(height: 52, width: 52),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                item.productName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                '× ${item.quantity}   ₱${item.subtotal.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static Color _statusColor(String status) {
    switch (status) {
      case 'cancelled':
        return AppColors.error;
      case 'delivered':
      case 'completed':
        return AppColors.success;
      case 'shipped':
        return AppColors.accent;
      case 'pending':
        return AppColors.textMuted;
      default:
        return AppColors.primaryMedium;
    }
  }
}
