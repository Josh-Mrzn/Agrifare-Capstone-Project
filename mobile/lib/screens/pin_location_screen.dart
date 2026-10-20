import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../services/geo_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';

/// Pins a delivery address on the map.
///
/// The pin stays in the middle; the buyer moves the map under it, or taps
/// "Use my location" to jump to where the phone is. Wherever it stops, the
/// app says what is there, and "Use this spot" hands back the point and the
/// province, city, barangay and street it matched, to fill the form.
class PinLocationScreen extends StatefulWidget {
  const PinLocationScreen({super.key, this.initial, this.locateOnOpen = true});

  /// An existing pin to start from.
  final LatLng? initial;

  /// Jump to the phone's location as soon as the map opens (when there is no
  /// existing pin).
  final bool locateOnOpen;

  @override
  State<PinLocationScreen> createState() => _PinLocationScreenState();
}

class _PinLocationScreenState extends State<PinLocationScreen> {
  /// Where the map opens when there is nothing better: Cabanatuan City.
  static const _fallback = LatLng(15.4863, 120.9670);

  final _map = MapController();
  late LatLng _center = widget.initial ?? _fallback;

  PinnedPlace? _place;
  bool _looking = false;
  bool _locating = false;
  String? _locationNote;
  Timer? _debounce;
  int _lookup = 0;

  @override
  void initState() {
    super.initState();
    if (widget.initial == null && widget.locateOnOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _useMyLocation());
    } else {
      _describe();
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  /// Asks what is at the centre, once the map has stopped moving.
  void _describeSoon() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 700), _describe);
  }

  Future<void> _describe() async {
    final ticket = ++_lookup;
    setState(() => _looking = true);
    final place = await GeoService.instance.whatIsAt(_center.latitude, _center.longitude);
    // A newer move has asked since; its answer is the one that matters.
    if (!mounted || ticket != _lookup) return;
    setState(() {
      _place = place;
      _looking = false;
    });
  }

  Future<void> _useMyLocation() async {
    setState(() {
      _locating = true;
      _locationNote = null;
    });

    String? problem;
    if (!await Geolocator.isLocationServiceEnabled()) {
      problem = 'Location is off on this phone. Turn it on, or move the map to your door.';
    } else {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        problem = 'Location is blocked for AgriFair. Allow it in Settings, or move the map to your door.';
      } else if (permission == LocationPermission.denied) {
        problem = 'Without location, move the map until the pin is on your door.';
      } else {
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 15),
            ),
          );
          _center = LatLng(pos.latitude, pos.longitude);
          _map.move(_center, 18);
        } on Exception {
          problem = 'Could not find where you are. Try outdoors, or move the map to your door.';
        }
      }
    }

    if (!mounted) return;
    setState(() {
      _locating = false;
      _locationNote = problem;
    });
    await _describe();
  }

  bool _confirming = false;

  /// Hands back the spot under the pin, with what is there. If the map moved
  /// since the last lookup, asks once more so the form fills in for the spot
  /// actually chosen.
  Future<void> _confirm() async {
    var place = _place;
    if (place == null || place.lat != _center.latitude || place.lng != _center.longitude) {
      setState(() => _confirming = true);
      place = await GeoService.instance.whatIsAt(_center.latitude, _center.longitude);
      if (!mounted) return;
      setState(() => _confirming = false);
    }
    Navigator.of(context).pop(place);
  }

  @override
  Widget build(BuildContext context) {
    final place = _place;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text('Pin your door'),
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: _center,
                    initialZoom: widget.initial == null ? 15 : 18,
                    interactionOptions: const InteractionOptions(
                      flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag | InteractiveFlag.doubleTapZoom,
                    ),
                    onPositionChanged: (camera, hasGesture) {
                      _center = camera.center;
                      if (hasGesture) _describeSoon();
                    },
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'ph.agrifair.mobile',
                    ),
                  ],
                ),
                // The pin itself, its point on the centre of the map.
                const IgnorePointer(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 44),
                    child: Icon(Icons.location_on_rounded, size: 48, color: AppColors.error),
                  ),
                ),
                Positioned(
                  right: 14,
                  bottom: 14,
                  child: ClayIconButton(
                    icon: Icons.my_location_rounded,
                    size: 50,
                    onPressed: _locating ? null : _useMyLocation,
                  ),
                ),
                const Positioned(
                  left: 8,
                  bottom: 6,
                  child: Text('© OpenStreetMap', style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _locating
                        ? 'Finding where you are…'
                        : _looking
                            ? 'Checking this spot…'
                            : (place?.summary.isNotEmpty ?? false)
                                ? place!.summary
                                : 'Move the map so the pin sits on your door.',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _locationNote ?? 'Drag the map to fine-tune. The rider is sent to exactly this spot.',
                    style: TextStyle(
                      fontSize: 12,
                      color: _locationNote == null ? AppColors.textMuted : AppColors.warning,
                    ),
                  ),
                  const SizedBox(height: 12),
                  ClayButton(
                    label: 'Use this spot',
                    icon: Icons.check_rounded,
                    isLoading: _confirming,
                    onPressed: _locating || _confirming ? null : _confirm,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
