import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/delivery_service.dart';
import '../services/rider_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/private_image.dart';
import 'welcome_screen.dart';

/// What a delivery rider sees instead of a shop.
///
/// A rider has no cart and nothing to browse. Their whole app is the list of
/// things to carry: where to collect it, where it goes, who to call, whether
/// there is cash to take, and the photo that proves it arrived.
///
/// Signing in used to land every account on the buyer's tabs, so a rider was
/// shown rice to buy. This screen is the answer to that.
class RiderHomeScreen extends StatefulWidget {
  const RiderHomeScreen({super.key});

  @override
  State<RiderHomeScreen> createState() => _RiderHomeScreenState();
}

class _RiderHomeScreenState extends State<RiderHomeScreen> {
  /// How often a position is sent while sharing is on.
  ///
  /// The phone reports far more often than a truck meaningfully moves, and the
  /// buyer's map only polls every fifteen seconds anyway.
  static const _pushEvery = Duration(seconds: 15);

  List<Delivery> _deliveries = const [];
  String? _error;
  bool _loading = true;
  String _busy = '';

  /// The order whose position is being broadcast, if any.
  String? _sharingId;
  StreamSubscription<Position>? _watch;
  DateTime _lastPush = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    // Stopped explicitly: a location stream left running is a battery
    // complaint the rider will blame on the app, and rightly.
    _watch?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final deliveries = await RiderService.instance.myDeliveries();
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

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _stopSharing() async {
    await _watch?.cancel();
    _watch = null;
    if (mounted) setState(() => _sharingId = null);
  }

  /// Follows the phone and sends the position while driving.
  Future<void> _startSharing(Delivery delivery) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _notify('Turn on location on this phone first.');
      return;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      _notify('AgriFair needs location permission to share where you are.');
      return;
    }

    await _stopSharing();
    _lastPush = DateTime.fromMillisecondsSinceEpoch(0);

    _watch = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 25,
      ),
    ).listen((position) async {
      if (DateTime.now().difference(_lastPush) < _pushEvery) return;
      _lastPush = DateTime.now();

      try {
        await RiderService.instance.pushLocation(
          delivery.orderId,
          lat: position.latitude,
          lng: position.longitude,
        );
      } on ApiException catch (err) {
        if (!mounted) return;
        _notify(err.message);
        await _stopSharing();
      }
    }, onError: (_) => _stopSharing());

    if (mounted) {
      setState(() => _sharingId = delivery.orderId);
      _notify('Sharing your location for ${delivery.orderNumber}.');
    }
  }

  /// The photo at the door. Taken with the camera, not picked from a gallery -
  /// proof of a delivery is taken at the delivery.
  Future<void> _markDelivered(Delivery delivery, String note) async {
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 70,
      maxWidth: 1600,
    );

    if (shot == null || !mounted) return;

    setState(() => _busy = delivery.orderId);

    try {
      await RiderService.instance.uploadProof(
        delivery.orderId,
        photoPath: shot.path,
        note: note,
      );

      if (_sharingId == delivery.orderId) await _stopSharing();
      if (!mounted) return;

      setState(() => _busy = '');
      _notify('Delivered. The shop and the buyer can both see the photo.');
      await _load();
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _busy = '');
      _notify(err.message);
    }
  }

  Future<void> _openMap(DeliveryPoint point, String label) async {
    if (!point.hasPoint) {
      _notify('No pin for $label — read the written address.');
      return;
    }

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}',
    );
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _notify('No maps app on this phone.');
    }
  }

  Future<void> _call(String number) async {
    final uri = Uri.parse('tel:$number');
    if (!await launchUrl(uri)) _notify('Could not open the dialler.');
  }

  Future<void> _signOut() async {
    await _stopSharing();
    if (!mounted) return;

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
    final name = UserModel.of(context).account?.name ?? 'Rider';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _header(name),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _header(String name) {
    final waiting = _deliveries.where((d) => !d.isDone).length;

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
                if (!_loading)
                  Text(
                    waiting == 0
                        ? 'Nothing waiting'
                        : '$waiting to deliver',
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textMuted,
                    ),
                  ),
              ],
            ),
          ),
          ClayIconButton(icon: Icons.refresh_rounded, size: 40, onPressed: _load),
          const SizedBox(width: 8),
          ClayIconButton(
            icon: Icons.logout_rounded,
            size: 40,
            onPressed: _signOut,
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
          ClaySkeleton(height: 210, radius: AppRadius.lg),
          SizedBox(height: 12),
          ClaySkeleton(height: 210, radius: AppRadius.lg),
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
            const ClayEmptyState(
              icon: Icons.local_shipping_outlined,
              title: 'Nothing assigned yet',
              message:
                  'Your shop puts orders here once they are ready to go out. '
                  'Pull down to check again.',
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
        itemBuilder: (context, i) => _DeliveryCard(
          delivery: _deliveries[i],
          sharing: _sharingId == _deliveries[i].orderId,
          busy: _busy == _deliveries[i].orderId,
          onShare: () => _sharingId == _deliveries[i].orderId
              ? _stopSharing()
              : _startSharing(_deliveries[i]),
          onDelivered: (note) => _markDelivered(_deliveries[i], note),
          onOpenMap: _openMap,
          onCall: _call,
        ),
      ),
    );
  }
}

class _DeliveryCard extends StatefulWidget {
  const _DeliveryCard({
    required this.delivery,
    required this.sharing,
    required this.busy,
    required this.onShare,
    required this.onDelivered,
    required this.onOpenMap,
    required this.onCall,
  });

  final Delivery delivery;
  final bool sharing;
  final bool busy;
  final VoidCallback onShare;
  final ValueChanged<String> onDelivered;
  final void Function(DeliveryPoint, String) onOpenMap;
  final ValueChanged<String> onCall;

  @override
  State<_DeliveryCard> createState() => _DeliveryCardState();
}

class _DeliveryCardState extends State<_DeliveryCard> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.delivery;

    return ClayCard(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      d.orderNumber,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${d.quantity}× ${d.productName}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        height: 1.35,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              ClayBadge(
                label: d.isDone ? 'Delivered' : d.status,
                color: d.isDone ? AppColors.success : AppColors.primaryMedium,
                compact: true,
              ),
            ],
          ),
          const SizedBox(height: 14),

          _leg(
            Icons.storefront_rounded,
            AppColors.primaryDark,
            'Pick up${d.shopName.isEmpty ? '' : ' at ${d.shopName}'}',
            d.pickup.address.isEmpty
                ? 'The shop has not written an address'
                : d.pickup.address,
            onMap: () => widget.onOpenMap(d.pickup, 'the pickup'),
          ),
          const SizedBox(height: 10),
          _leg(
            Icons.home_rounded,
            AppColors.accent,
            'Deliver to ${d.customerName}',
            d.dropoff.address,
            hint: d.dropoff.isApproximate
                ? 'The pin is the barangay, not the door. Read the address and '
                    'the landmark from there.'
                : null,
            onMap: () => widget.onOpenMap(d.dropoff, 'the delivery'),
            onCall: d.customerContact.isEmpty
                ? null
                : () => widget.onCall(d.customerContact),
          ),

          if (d.notes.isNotEmpty) ...[
            const SizedBox(height: 10),
            ClaySunken(
              padding: const EdgeInsets.all(11),
              child: Text(
                'Note from the buyer: ${d.notes}',
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  color: AppColors.textBody,
                ),
              ),
            ),
          ],

          const SizedBox(height: 12),
          Row(
            children: [
              Icon(
                d.collectsCash
                    ? Icons.payments_rounded
                    : Icons.check_circle_rounded,
                size: 15,
                color: d.collectsCash ? AppColors.warning : AppColors.success,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  // The one thing a rider must not get wrong at the door.
                  d.collectsCash
                      ? 'Collect ₱${d.total.toStringAsFixed(0)} — ${d.paymentMethod}'
                      : 'Already paid — ${d.paymentMethod}',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: d.collectsCash
                        ? AppColors.warning
                        : AppColors.textBody,
                  ),
                ),
              ),
            ],
          ),

          if (d.isDone) ...[
            const SizedBox(height: 12),
            GestureDetector(
              onTap: () => showPrivateImage(
                context,
                path: d.proofOfDelivery,
                title: 'Proof for ${d.orderNumber}',
              ),
              child: PrivateImage(
                path: d.proofOfDelivery,
                height: 120,
                width: double.infinity,
                radius: AppRadius.md,
                fallbackIcon: Icons.local_shipping_rounded,
              ),
            ),
            if (d.deliveryNote.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                d.deliveryNote,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ] else ...[
            const SizedBox(height: 14),
            ClayButton(
              label: widget.sharing
                  ? 'Sharing your location — tap to stop'
                  : 'Share my location',
              icon: Icons.near_me_rounded,
              filled: false,
              onPressed: widget.onShare,
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _note,
              decoration: const InputDecoration(
                hintText: 'Who received it? (optional)',
                isDense: true,
              ),
            ),
            const SizedBox(height: 10),
            if (d.status == 'shipped')
              ClayButton(
                label: 'Take the photo at the door',
                icon: Icons.photo_camera_rounded,
                isLoading: widget.busy,
                onPressed: widget.busy
                    ? null
                    : () => widget.onDelivered(_note.text),
              )
            else
              const Text(
                'The shop has not sent this order out yet. You can take the '
                'photo once it is marked out for delivery.',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
          ],
        ],
      ),
    );
  }

  Widget _leg(
    IconData icon,
    Color color,
    String label,
    String value, {
    String? hint,
    VoidCallback? onMap,
    VoidCallback? onCall,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 24,
          width: 24,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Icon(icon, size: 13, color: Colors.white),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value.isEmpty ? 'No address' : value,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textBody,
                ),
              ),
              if (hint != null) ...[
                const SizedBox(height: 3),
                Text(
                  hint,
                  style: const TextStyle(
                    fontSize: 11,
                    height: 1.4,
                    color: AppColors.warning,
                  ),
                ),
              ],
              const SizedBox(height: 6),
              Row(
                children: [
                  if (onMap != null)
                    _tinyAction(Icons.map_rounded, 'Open in maps', onMap),
                  if (onCall != null) ...[
                    const SizedBox(width: 14),
                    _tinyAction(Icons.call_rounded, 'Call', onCall),
                  ],
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _tinyAction(IconData icon, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.primaryMedium),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.primaryMedium,
            ),
          ),
        ],
      ),
    );
  }
}
