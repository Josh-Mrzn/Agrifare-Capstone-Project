import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/order.dart';
import '../services/api_client.dart';
import '../services/order_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/delivery_map.dart';
import '../widgets/private_image.dart';
import 'write_review_screen.dart';

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.order});

  final OrderGroup order;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late OrderGroup _order = widget.order;
  bool _cancelling = false;
  bool _confirming = false;

  Future<void> _confirmReceived() async {
    setState(() => _confirming = true);

    try {
      final fresh = await OrderService.instance.confirmReceived(_order.groupId);
      if (!mounted) return;
      setState(() {
        _order = fresh;
        _confirming = false;
      });
      _notify('Thanks. The seller has been told your order arrived.');
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _confirming = false);
      _notify(err.message);
    }
  }

  Future<void> _refresh() async {
    try {
      final fresh = await OrderService.instance.byGroupId(_order.groupId);
      if (!mounted) return;
      setState(() => _order = fresh);
    } on ApiException {
      // The screen already has a usable copy; a failed refresh is not worth
      // replacing it with an error.
    }
  }

  Future<void> _cancel() async {
    final reason = await _askReason();
    if (reason == null || !mounted) return;

    setState(() => _cancelling = true);

    try {
      final message = await OrderService.instance.cancel(_order.groupId, reason);
      if (!mounted) return;

      setState(() => _cancelling = false);
      _notify(message);
      await _refresh();
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _cancelling = false);
      // The server owns this decision - a seller may have confirmed the order
      // in the meantime - so its answer is shown as written.
      _notify(err.message);
    }
  }

  /// A cancellation without a reason tells the seller nothing, and the backend
  /// requires one anyway.
  Future<String?> _askReason() {
    final controller = TextEditingController();

    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
        ),
        title: const Text(
          'Cancel this order?',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'The seller will see why. This cannot be undone.',
              style: TextStyle(fontSize: 13.5, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              maxLines: 2,
              decoration: const InputDecoration(hintText: 'Reason'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            style: TextButton.styleFrom(foregroundColor: AppColors.textMuted),
            child: const Text('Keep order'),
          ),
          TextButton(
            onPressed: () {
              final reason = controller.text.trim();
              if (reason.isEmpty) return;
              Navigator.of(context).pop(reason);
            },
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Cancel order'),
          ),
        ],
      ),
    );
  }

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

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
        title: Text(_order.orderNumber),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        color: AppColors.primaryMedium,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
          children: [
            _statusCard(),

            // The map goes above the receipt: once the rice is on the road,
            // where it is matters more than what it cost.
            ..._trackingSection(),

            const SizedBox(height: 16),
            _itemsCard(),
            const SizedBox(height: 16),
            _totalsCard(),
            ..._reviewSection(),
            if (_order.hasReceipt) ...[
              const SizedBox(height: 16),
              _receiptCard(),
            ],
            if (_order.deliveryAddress.isNotEmpty) ...[
              const SizedBox(height: 16),
              _deliveryCard(),
            ],
            if (_order.canConfirmReceived) ...[
              const SizedBox(height: 24),
              ClayButton(
                label: 'I received my order',
                isLoading: _confirming,
                onPressed: _confirming ? null : _confirmReceived,
              ),
            ],
            if (_order.canCancel) ...[
              const SizedBox(height: 24),
              ClayButton(
                label: 'Cancel this order',
                filled: false,
                isLoading: _cancelling,
                onPressed: _cancelling ? null : _cancel,
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// One map per line, shown once the rice has left the shop.
  ///
  /// Per line rather than per order, because a basket split across two sellers
  /// is two journeys from two different shops - a single map would have to
  /// pick one of them and be wrong about the other.
  List<Widget> _trackingSection() {
    const onTheRoad = {'shipped', 'delivered', 'completed'};

    final tracked = _order.items
        .where((item) => item.orderId.isNotEmpty && onTheRoad.contains(item.status))
        .toList();

    if (tracked.isEmpty) return const [];

    return [
      const SizedBox(height: 16),
      for (final item in tracked) ...[
        DeliveryMapCard(
          key: ValueKey(item.orderId),
          orderId: item.orderId,
          productName: item.productName,
        ),
        const SizedBox(height: 12),
      ],
    ];
  }

  Widget _statusCard() {
    return ClayCard(
      child: Row(
        children: [
          Container(
            height: 46,
            width: 46,
            decoration: BoxDecoration(
              color: AppColors.surfaceSunken,
              shape: BoxShape.circle,
            ),
            child: Icon(
              _statusIcon(_order.status),
              size: 21,
              color: _statusColor(_order.status),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _order.statusLabel,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textDark,
                  ),
                ),
                if (_order.orderDate != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    'Placed ${_dateLabel(_order.orderDate!)}',
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemsCard() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('Items'),
          const SizedBox(height: 14),
          for (var i = 0; i < _order.items.length; i++) ...[
            if (i > 0) ...[
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 12),
            ],
            _itemRow(_order.items[i]),
          ],
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
            height: 56,
            width: 56,
            child: item.imageUrl.isEmpty
                ? Container(
                    color: AppColors.surfaceSunken,
                    child: const Icon(
                      Icons.rice_bowl_outlined,
                      size: 24,
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
                        size: 24,
                        color: AppColors.primaryLight,
                      ),
                    ),
                    placeholder: (_, _) =>
                        const ClaySkeleton(height: 56, width: 56),
                  ),
          ),
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                item.productName,
                style: const TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '₱${item.unitPrice.toStringAsFixed(0)} × ${item.quantity}',
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
        Text(
          '₱${item.subtotal.toStringAsFixed(0)}',
          style: const TextStyle(
            fontSize: 14.5,
            fontWeight: FontWeight.w700,
            color: AppColors.textDark,
          ),
        ),
      ],
    );
  }

  Widget _totalsCard() {
    final subtotal = _order.total - _order.deliveryFee;

    return ClayCard(
      child: Column(
        children: [
          _totalRow('Subtotal', subtotal),
          if (_order.deliveryFee > 0) ...[
            const SizedBox(height: 9),
            _totalRow('Delivery', _order.deliveryFee),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text(
                'Total',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark,
                ),
              ),
              const Spacer(),
              Text(
                '₱${_order.total.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          ),
          if (_order.paymentMethod.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(
                  Icons.payments_outlined,
                  size: 15,
                  color: AppColors.textMuted,
                ),
                const SizedBox(width: 7),
                Text(
                  _order.paymentMethod,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// The receipt the buyer sent, on the order it paid for.
  ///
  /// Shown to them rather than only to the seller: they are the one who parted
  /// with the money, and "did my proof actually go through?" is the first
  /// question a GCash order raises.
  /// A review invitation per delivered line.
  ///
  /// Per line, because a review is written against the order row - that is
  /// what lets the server check the person actually received this rice, and
  /// only let them say so once.
  List<Widget> _reviewSection() {
    if (_order.status != 'completed') return const [];

    final reviewable =
        _order.items.where((item) => item.orderId.isNotEmpty).toList();
    if (reviewable.isEmpty) return const [];

    return [
      const SizedBox(height: 16),
      ClayCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'HOW WAS IT?',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
                color: AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Your rating and photos show on the seller\'s product, so the '
              'next buyer can see what actually arrived.',
              style: TextStyle(
                fontSize: 12.5,
                height: 1.45,
                color: AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < reviewable.length; i++) ...[
              if (i > 0) const SizedBox(height: 10),
              ClayButton(
                label: reviewable.length == 1
                    ? 'Write a review'
                    : 'Review ${reviewable[i].productName}',
                filled: false,
                icon: Icons.star_rounded,
                onPressed: () => _writeReview(reviewable[i]),
              ),
            ],
          ],
        ),
      ),
    ];
  }

  Future<void> _writeReview(OrderItem item) async {
    final posted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => WriteReviewScreen(
          orderId: item.orderId,
          productName: item.productName,
        ),
      ),
    );

    // A posted review moves the order out of To Review, so the screen behind
    // is stale.
    if (posted == true && mounted) await _refresh();
  }

  Widget _receiptCard() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'YOUR GCASH RECEIPT',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.1,
                  color: AppColors.textMuted,
                ),
              ),
              const Spacer(),
              if (_order.paymentStatus == 'paid')
                const ClayBadge(
                  label: 'Confirmed',
                  color: AppColors.success,
                  compact: true,
                )
              else if (_order.paymentStatus == 'rejected')
                const ClayBadge(
                  label: 'Not received',
                  color: AppColors.error,
                  compact: true,
                )
              else
                const ClayBadge(label: 'Waiting on seller', compact: true),
            ],
          ),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: () => showPrivateImage(
              context,
              path: _order.paymentProof,
              title: 'Your GCash receipt',
            ),
            child: PrivateImage(
              path: _order.paymentProof,
              height: 150,
              width: double.infinity,
              radius: AppRadius.md,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            _order.paymentReference.isEmpty
                ? 'Tap to see it full size.'
                : 'Reference ${_order.paymentReference}. Tap to see it full size.',
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, double value) {
    return Row(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 13.5, color: AppColors.textMuted),
        ),
        const Spacer(),
        Text(
          '₱${value.toStringAsFixed(0)}',
          style: const TextStyle(fontSize: 13.5, color: AppColors.textBody),
        ),
      ],
    );
  }

  Widget _deliveryCard() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('Delivering to'),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.place_rounded,
                size: 16,
                color: AppColors.primaryLight,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  _order.deliveryAddress,
                  style: const TextStyle(
                    fontSize: 13.5,
                    color: AppColors.textBody,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static IconData _statusIcon(String status) {
    switch (status) {
      case 'cancelled':
        return Icons.cancel_rounded;
      case 'delivered':
      case 'completed':
        return Icons.check_circle_rounded;
      case 'shipped':
        return Icons.local_shipping_rounded;
      case 'processing':
        return Icons.inventory_2_rounded;
      default:
        return Icons.schedule_rounded;
    }
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
      default:
        return AppColors.primaryMedium;
    }
  }

  static String _dateLabel(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day} ${months[date.month - 1]} ${date.year}';
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        letterSpacing: 1.1,
        color: AppColors.textMuted,
      ),
    );
  }
}
