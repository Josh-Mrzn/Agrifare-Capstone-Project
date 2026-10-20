import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// A road route between two points, as OSRM drew it.
class RoadRoute {
  const RoadRoute({
    required this.points,
    required this.distanceMeters,
    required this.durationSeconds,
    this.isStraightLine = false,
  });

  final List<LatLng> points;
  final double distanceMeters;
  final double durationSeconds;

  /// True when no road route could be fetched and the line is only the
  /// direct distance - shown as such, never passed off as the road.
  final bool isStraightLine;

  String get distanceLabel => distanceMeters >= 1000
      ? '${(distanceMeters / 1000).toStringAsFixed(1)} km'
      : '${distanceMeters.round()} m';

  String get durationLabel {
    final minutes = (durationSeconds / 60).round();
    if (minutes < 60) return '$minutes min';
    return '${minutes ~/ 60} h ${minutes % 60} min';
  }
}

/// Road routes from the public OSRM server, the same OpenStreetMap data the
/// map tiles come from. No API key, so nothing to leak and nothing to pay;
/// the public server is for light use, which one rider asking now and then
/// is. When it cannot be reached the rider gets the straight line and the
/// "Open in Google Maps" button, which works with the phone's own app.
class RouteService {
  RouteService._();

  static final RouteService instance = RouteService._();

  static const _base = 'https://router.project-osrm.org/route/v1/driving';

  Future<RoadRoute> route(LatLng from, LatLng to) async {
    final uri = Uri.parse(
      '$_base/${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
      '?overview=full&geometries=geojson',
    );
    try {
      final res = await http
          .get(uri, headers: {'user-agent': 'AgriFair-rider-app'})
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return straightLine(from, to);

      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final routes = body['routes'] as List? ?? const [];
      if (body['code'] != 'Ok' || routes.isEmpty) return straightLine(from, to);

      final first = routes.first as Map<String, dynamic>;
      final coords = (first['geometry']?['coordinates'] as List? ?? const [])
          .whereType<List>()
          .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
          .toList();
      if (coords.length < 2) return straightLine(from, to);

      return RoadRoute(
        points: coords,
        distanceMeters: (first['distance'] as num?)?.toDouble() ?? 0,
        durationSeconds: (first['duration'] as num?)?.toDouble() ?? 0,
      );
    } on SocketException {
      return straightLine(from, to);
    } on TimeoutException {
      return straightLine(from, to);
    } on FormatException {
      return straightLine(from, to);
    }
  }

  /// The direct distance, at a rough 25 km/h for town roads.
  RoadRoute straightLine(LatLng from, LatLng to) {
    final meters = const Distance().as(LengthUnit.Meter, from, to);
    return RoadRoute(
      points: [from, to],
      distanceMeters: meters,
      durationSeconds: meters / (25000 / 3600),
      isStraightLine: true,
    );
  }

  /// Turn-by-turn in the phone's own Google Maps, which knows traffic and
  /// speaks the directions.
  Uri googleMapsDirections(LatLng to, {LatLng? from}) => Uri.parse(
        'https://www.google.com/maps/dir/?api=1'
        '${from == null ? '' : '&origin=${from.latitude},${from.longitude}'}'
        '&destination=${to.latitude},${to.longitude}&travelmode=driving',
      );
}
