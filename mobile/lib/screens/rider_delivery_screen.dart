import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_client.dart';
import '../services/delivery_service.dart';
import '../services/rider_service.dart';
import '../services/route_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/private_image.dart';
import 'conversation_screen.dart';
import 'rider_home_screen.dart' show deliveryStage;

/// One delivery, step by step: accept it, pick it up, follow the route,
/// take the photo at the door, record the cash, mark it delivered.
class RiderDeliveryScreen extends StatefulWidget {
  const RiderDeliveryScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<RiderDeliveryScreen> createState() => _RiderDeliveryScreenState();
}

class _RiderDeliveryScreenState extends State<RiderDeliveryScreen> {
  /// How often a position is sent while sharing is on. The buyer's map polls
  /// every fifteen seconds, so sending more often only spends battery.
  static const _pushEvery = Duration(seconds: 15);

  final _map = MapController();
  final _cash = TextEditingController();
  final _note = TextEditingController();

  Delivery? _delivery;
  String? _error;
  bool _busy = false;

  LatLng? _me;
  String? _locationProblem;
  RoadRoute? _route;
  bool _routing = false;

  bool _sharing = false;
  StreamSubscription<Position>? _watch;
  DateTime _lastPush = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    // A location stream left running is a battery complaint the rider will
    // blame on the app, and rightly.
    _watch?.cancel();
    _cash.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await RiderService.instance.delivery(widget.orderId);
      if (!mounted) return;
      setState(() {
        _delivery = d;
        _error = null;
      });
      if (!d.isDone) unawaited(_locateAndRoute());
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _error = err.message);
    }
  }

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// Asks for location once, explaining a refusal instead of failing quietly.
  Future<bool> _locationAllowed() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      setState(() => _locationProblem = 'Location is off on this phone. Turn it on to see your route.');
      return false;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      setState(() => _locationProblem =
          'Location permission is blocked. Allow it for AgriFair in the phone settings to see your route.');
      return false;
    }
    if (permission == LocationPermission.denied) {
      setState(() => _locationProblem = 'Without location the map shows the shop and the door only.');
      return false;
    }
    setState(() => _locationProblem = null);
    return true;
  }

  /// Where the rider should head next: the shop until it is picked up, then
  /// the buyer's door.
  DeliveryPoint get _target {
    final d = _delivery!;
    return d.isOnTheWay ? d.dropoff : d.pickup;
  }

  Future<void> _locateAndRoute() async {
    final d = _delivery;
    if (d == null) return;
    setState(() => _routing = true);

    if (await _locationAllowed()) {
      try {
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
        );
        _me = LatLng(pos.latitude, pos.longitude);
      } on Exception {
        _locationProblem = 'Could not find where you are right now. Showing the shop and the door.';
      }
    }

    final target = _target;
    final from = _me;
    RoadRoute? route;
    if (target.hasPoint) {
      final to = LatLng(target.lat!, target.lng!);
      if (from != null) {
        route = await RouteService.instance.route(from, to);
      } else if (d.pickup.hasPoint && d.dropoff.hasPoint) {
        route = await RouteService.instance.route(
          LatLng(d.pickup.lat!, d.pickup.lng!),
          LatLng(d.dropoff.lat!, d.dropoff.lng!),
        );
      }
    }
    if (!mounted) return;
    setState(() {
      _route = route;
      _routing = false;
    });
    _fit();
  }

  void _fit() {
    final pts = <LatLng>[
      ...?_route?.points,
      ?_me,
      if (_delivery?.pickup.hasPoint ?? false) LatLng(_delivery!.pickup.lat!, _delivery!.pickup.lng!),
      if (_delivery?.dropoff.hasPoint ?? false) LatLng(_delivery!.dropoff.lat!, _delivery!.dropoff.lng!),
    ];
    if (pts.length < 2) return;
    try {
      _map.fitCamera(CameraFit.coordinates(coordinates: pts, padding: const EdgeInsets.all(36)));
    } on Exception {
      // The map is not laid out yet; it opens on the first point instead.
    }
  }

  Future<void> _navigate() async {
    final target = _target;
    if (!target.hasPoint) {
      _notify('No pin for this stop. Follow the written address.');
      return;
    }
    final uri = RouteService.instance.googleMapsDirections(LatLng(target.lat!, target.lng!), from: _me);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _notify('Could not open Google Maps on this phone.');
    }
  }

  Future<void> _call(String number) async {
    if (!await launchUrl(Uri.parse('tel:$number'))) _notify('Could not open the dialler.');
  }

  void _message({required int? userId, required String name, String? orderRef}) {
    if (userId == null) {
      _notify('This order was typed in by the shop, so there is no account to message. Call instead.');
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ConversationScreen(otherUserId: userId, otherName: name, orderRef: orderRef),
    ));
  }

  /// Runs one step, then reloads the delivery.
  Future<void> _run(Future<void> Function() step, String done) async {
    setState(() => _busy = true);
    try {
      await step();
      if (!mounted) return;
      _notify(done);
      await _load();
    } on ApiException catch (err) {
      if (!mounted) return;
      _notify(err.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _decline() async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Decline this delivery?'),
        content: TextField(
          controller: reason,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Why you cannot take it'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Decline')),
        ],
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (ok != true) return;
    if (why.isEmpty) {
      _notify('Say why, so the shop can plan.');
      return;
    }
    setState(() => _busy = true);
    try {
      await RiderService.instance.decline(widget.orderId, why);
      if (!mounted) return;
      _notify('Declined. The shop will choose someone else.');
      Navigator.of(context).pop();
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _busy = false);
      _notify(err.message);
    }
  }

  Future<void> _toggleSharing() async {
    if (_sharing) {
      await _watch?.cancel();
      _watch = null;
      setState(() => _sharing = false);
      return;
    }
    if (!await _locationAllowed()) {
      _notify(_locationProblem ?? 'Location is needed to share where you are.');
      return;
    }
    _lastPush = DateTime.fromMillisecondsSinceEpoch(0);
    _watch = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 25),
    ).listen((position) async {
      if (mounted) setState(() => _me = LatLng(position.latitude, position.longitude));
      if (DateTime.now().difference(_lastPush) < _pushEvery) return;
      _lastPush = DateTime.now();
      try {
        await RiderService.instance.pushLocation(widget.orderId, lat: position.latitude, lng: position.longitude);
      } on ApiException catch (err) {
        if (!mounted) return;
        _notify(err.message);
        await _watch?.cancel();
        setState(() => _sharing = false);
      }
    }, onError: (_) {
      if (mounted) setState(() => _sharing = false);
    });
    setState(() => _sharing = true);
    _notify('Sharing your location with the buyer and the shop.');
  }

  /// The photo at the door, from the camera: proof of a delivery is taken at
  /// the delivery, not picked from a gallery.
  Future<void> _takePhoto() async {
    final shot = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 1600);
    if (shot == null || !mounted) return;
    await _run(
      () => RiderService.instance.uploadProof(widget.orderId, photoPath: shot.path, note: _note.text),
      'Photo saved. Now mark it as delivered.',
    );
  }

  Future<void> _markDelivered() async {
    final d = _delivery!;
    double? cash;
    if (d.isCod) {
      cash = double.tryParse(_cash.text.replaceAll(',', '').trim());
      if (cash == null || cash < 0) {
        _notify('Enter the cash you collected, in pesos.');
        return;
      }
      if ((cash - d.total).abs() >= 0.005) {
        final go = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Amount does not match'),
            content: Text(
              'You entered ₱${cash!.toStringAsFixed(2)} but ₱${d.total.toStringAsFixed(2)} is due. '
              'The shop will be asked to check it. Record it anyway?',
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Fix it')),
              TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Record')),
            ],
          ),
        );
        if (go != true) return;
      }
    }
    await _run(() async {
      await RiderService.instance.markDelivered(widget.orderId, cashCollected: cash, note: _note.text);
      await _watch?.cancel();
      _watch = null;
      _sharing = false;
    }, 'Delivered. The shop and the buyer have been told.');
  }

  @override
  Widget build(BuildContext context) {
    final d = _delivery;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Text(d?.orderNumber ?? 'Delivery'),
      ),
      body: d == null
          ? (_error != null
              ? ClayEmptyState(
                  icon: Icons.wifi_off_rounded,
                  title: 'Could not open this delivery',
                  message: _error!,
                  actionLabel: 'Try again',
                  onAction: _load,
                )
              : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              color: AppColors.primaryMedium,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 4, 18, 32),
                children: [
                  _summary(d),
                  const SizedBox(height: 12),
                  if (!d.isDone) ...[_mapCard(d), const SizedBox(height: 12)],
                  _people(d),
                  const SizedBox(height: 12),
                  _payment(d),
                  const SizedBox(height: 12),
                  _actions(d),
                ],
              ),
            ),
    );
  }

  Widget _summary(Delivery d) {
    final (label, color) = deliveryStage(d);
    return ClayCard(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Text(
                d.shopName.isEmpty ? 'Delivery' : 'From ${d.shopName}',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
            ),
            ClayBadge(label: label, color: color, compact: true),
          ]),
          const SizedBox(height: 8),
          for (final item in d.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text(item.label, style: const TextStyle(fontSize: 13, color: AppColors.textBody)),
            ),
          if (d.notes.isNotEmpty) ...[
            const SizedBox(height: 8),
            ClaySunken(
              padding: const EdgeInsets.all(11),
              child: Text('Note from the buyer: ${d.notes}', style: const TextStyle(fontSize: 12, height: 1.45, color: AppColors.textBody)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _mapCard(Delivery d) {
    final pickup = d.pickup.hasPoint ? LatLng(d.pickup.lat!, d.pickup.lng!) : null;
    final dropoff = d.dropoff.hasPoint ? LatLng(d.dropoff.lat!, d.dropoff.lng!) : null;
    final center = _me ?? (d.isOnTheWay ? dropoff ?? pickup : pickup ?? dropoff);
    final route = _route;

    return ClayCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            d.isOnTheWay ? 'Route to the buyer' : 'Route to the shop',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.textDark),
          ),
          const SizedBox(height: 4),
          Text(
            _routing
                ? 'Finding the route…'
                : route == null
                    ? 'No pin for this stop. Follow the written address.'
                    : route.isStraightLine
                        ? 'About ${route.distanceLabel} in a straight line. No road route right now; use Google Maps to navigate.'
                        : '${route.distanceLabel}, about ${route.durationLabel} by road',
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
          if (_locationProblem != null) ...[
            const SizedBox(height: 4),
            Text(_locationProblem!, style: const TextStyle(fontSize: 11.5, color: AppColors.warning)),
          ],
          if (d.isOnTheWay && d.dropoff.isApproximate) ...[
            const SizedBox(height: 4),
            const Text(
              'The pin is the barangay, not the door. Read the address and landmark from there.',
              style: TextStyle(fontSize: 11.5, color: AppColors.warning),
            ),
          ],
          const SizedBox(height: 10),
          if (center != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: SizedBox(
                height: 230,
                child: FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: center,
                    initialZoom: 14,
                    onMapReady: _fit,
                    interactionOptions: const InteractionOptions(
                      flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
                    ),
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'ph.agrifair.mobile',
                    ),
                    if (route != null)
                      PolylineLayer(polylines: [
                        Polyline(
                          points: route.points,
                          strokeWidth: 4,
                          color: AppColors.primaryMedium.withValues(alpha: 0.8),
                          pattern: route.isStraightLine
                              ? StrokePattern.dashed(segments: const [7, 6])
                              : const StrokePattern.solid(),
                        ),
                      ]),
                    MarkerLayer(markers: [
                      if (pickup != null) _pin(pickup, Icons.storefront_rounded, AppColors.primaryDark),
                      if (dropoff != null) _pin(dropoff, Icons.home_rounded, AppColors.accent),
                      if (_me != null) _pin(_me!, Icons.two_wheeler_rounded, const Color(0xFF2563EB)),
                    ]),
                  ],
                ),
              ),
            )
          else
            const Text('Neither stop has a pin. Use the written addresses below.',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: ClayButton(
                label: 'Navigate in Google Maps',
                icon: Icons.navigation_rounded,
                onPressed: _navigate,
              ),
            ),
            const SizedBox(width: 8),
            ClayIconButton(icon: Icons.my_location_rounded, size: 48, onPressed: _locateAndRoute),
          ]),
        ],
      ),
    );
  }

  Marker _pin(LatLng at, IconData icon, Color color) => Marker(
        point: at,
        width: 34,
        height: 34,
        child: Container(
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: Icon(icon, size: 17, color: Colors.white),
        ),
      );

  Widget _people(Delivery d) {
    return ClayCard(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _stop(
            Icons.storefront_rounded,
            AppColors.primaryDark,
            'Pick up${d.shopName.isEmpty ? '' : ' at ${d.shopName}'}',
            d.pickup.address.isEmpty ? 'The shop has not written an address' : d.pickup.address,
            onCall: d.shopContact.isEmpty ? null : () => _call(d.shopContact),
            onMessage: () => _message(userId: d.sellerUserId, name: d.shopName),
          ),
          const Divider(height: 22),
          _stop(
            Icons.home_rounded,
            AppColors.accent,
            'Deliver to ${d.customerName}',
            d.dropoff.address,
            onCall: d.customerContact.isEmpty ? null : () => _call(d.customerContact),
            // Only while the delivery is open: the thread is about this order.
            onMessage: d.isDone ? null : () => _message(userId: d.buyerUserId, name: d.customerName, orderRef: d.groupId),
          ),
        ],
      ),
    );
  }

  Widget _stop(IconData icon, Color color, String label, String value, {VoidCallback? onCall, VoidCallback? onMessage}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 26,
          width: 26,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Icon(icon, size: 14, color: Colors.white),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textMuted)),
              const SizedBox(height: 2),
              Text(value.isEmpty ? 'No address' : value,
                  style: const TextStyle(fontSize: 13, height: 1.4, fontWeight: FontWeight.w600, color: AppColors.textBody)),
              const SizedBox(height: 6),
              Wrap(spacing: 16, children: [
                if (onCall != null) _link(Icons.call_rounded, 'Call', onCall),
                if (onMessage != null) _link(Icons.chat_bubble_rounded, 'Message', onMessage),
              ]),
            ],
          ),
        ),
      ],
    );
  }

  Widget _link(IconData icon, String label, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 15, color: AppColors.primaryMedium),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.primaryMedium)),
          ]),
        ),
      );

  Widget _payment(Delivery d) {
    final text = d.collectsCash
        ? 'Collect ₱${d.amountToCollect.toStringAsFixed(2)} in cash'
        : d.isCod && d.cashCollected != null
            ? 'You recorded ₱${d.cashCollected!.toStringAsFixed(2)} collected'
            : 'Already paid (${d.paymentMethod}). Collect nothing.';
    return ClaySunken(
      padding: const EdgeInsets.all(13),
      child: Row(children: [
        Icon(d.collectsCash ? Icons.payments_rounded : Icons.check_circle_rounded,
            color: d.collectsCash ? AppColors.warning : AppColors.success, size: 20),
        const SizedBox(width: 10),
        Expanded(
          child: Text(text,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: d.collectsCash ? AppColors.warning : AppColors.textBody,
              )),
        ),
      ]),
    );
  }

  Widget _actions(Delivery d) {
    if (d.isWaitingForAnswer) {
      return Column(children: [
        ClayButton(
          label: 'Accept delivery',
          icon: Icons.check_rounded,
          isLoading: _busy,
          onPressed: _busy ? null : () => _run(() => RiderService.instance.accept(widget.orderId), 'Accepted. The shop has been told.'),
        ),
        const SizedBox(height: 10),
        ClayButton(label: 'Decline', icon: Icons.close_rounded, filled: false, onPressed: _busy ? null : _decline),
      ]);
    }

    if (d.isDone) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            d.deliveredAt == null ? 'Delivered.' : 'Delivered ${_when(d.deliveredAt!)}.',
            style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.success),
          ),
          if (d.hasProof) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: () => showPrivateImage(context, path: d.proofOfDelivery, title: 'Proof for ${d.orderNumber}'),
              child: PrivateImage(
                path: d.proofOfDelivery,
                height: 160,
                width: double.infinity,
                radius: AppRadius.md,
                fallbackIcon: Icons.local_shipping_rounded,
              ),
            ),
          ],
        ],
      );
    }

    if (d.status == 'confirmed') {
      return const Text(
        'The shop is still preparing this order. You can pick it up once they finish packing.',
        style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
      );
    }

    if (d.canStart) {
      return ClayButton(
        label: 'Picked up. Start delivery',
        icon: Icons.local_shipping_rounded,
        isLoading: _busy,
        onPressed: _busy ? null : () => _run(() => RiderService.instance.start(widget.orderId), 'On the way. The buyer has been told.'),
      );
    }

    // On the way: share location, photo, cash, mark delivered.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ClayButton(
          label: _sharing ? 'Sharing location. Tap to stop' : 'Share my location',
          icon: Icons.near_me_rounded,
          filled: false,
          onPressed: _toggleSharing,
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _note,
          decoration: const InputDecoration(hintText: 'Who received it? (optional)', isDense: true),
        ),
        const SizedBox(height: 10),
        if (d.hasProof) ...[
          PrivateImage(
            path: d.proofOfDelivery,
            height: 140,
            width: double.infinity,
            radius: AppRadius.md,
            fallbackIcon: Icons.photo_rounded,
          ),
          const SizedBox(height: 8),
        ],
        ClayButton(
          label: d.hasProof ? 'Retake the photo' : '1. Take the photo at the door',
          icon: Icons.photo_camera_rounded,
          filled: !d.hasProof,
          isLoading: _busy && !d.hasProof,
          onPressed: _busy ? null : _takePhoto,
        ),
        if (d.isCod) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _cash,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
            decoration: InputDecoration(
              labelText: 'Cash you collected (₱)',
              helperText: 'Due: ₱${d.total.toStringAsFixed(2)}. Enter what you actually received.',
              isDense: true,
            ),
          ),
        ],
        const SizedBox(height: 12),
        ClayButton(
          label: '2. Mark as delivered',
          icon: Icons.task_alt_rounded,
          isLoading: _busy && d.hasProof,
          onPressed: _busy || !d.hasProof ? null : _markDelivered,
        ),
        if (!d.hasProof)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('Take the photo first.', style: TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
          ),
      ],
    );
  }

  String _when(DateTime at) {
    final local = at.toLocal();
    final hh = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final mm = local.minute.toString().padLeft(2, '0');
    return '${local.month}/${local.day} at $hh:$mm ${local.hour < 12 ? 'AM' : 'PM'}';
  }
}
