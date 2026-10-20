import 'api_client.dart';

/// A province, city or municipality, as the picker needs it.
class Place {
  const Place({required this.code, required this.name, this.oldName = ''});

  final String code;
  final String name;

  /// A former name, where the PSGC records one - so someone searching for
  /// what a place used to be called still finds it.
  final String oldName;

  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;

    return name.toLowerCase().contains(q) || oldName.toLowerCase().contains(q);
  }

  factory Place.fromJson(Map<String, dynamic> json) {
    return Place(
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      oldName: (json['oldName'] ?? '').toString(),
    );
  }
}

/// Philippine places, from our own backend rather than a third party.
///
/// Each answer is kept for the life of the app run: a picker reopened while
/// filling in one address should not refetch the same list, and the places of
/// the Philippines do not change between two taps.
class GeoService {
  GeoService._();

  static final GeoService instance = GeoService._();

  final _api = ApiClient.instance;

  List<Place>? _provinces;
  final _cities = <String, List<Place>>{};
  final _barangays = <String, List<String>>{};

  List<Place> _places(dynamic body) {
    if (body is! List) return const [];

    return body
        .whereType<Map<String, dynamic>>()
        .map(Place.fromJson)
        .where((p) => p.code.isNotEmpty)
        .toList();
  }

  Future<List<Place>> provinces() async {
    return _provinces ??= _places(await _api.get('/geo/provinces'));
  }

  Future<List<Place>> cities(String provinceCode) async {
    if (_cities.containsKey(provinceCode)) return _cities[provinceCode]!;

    final list = _places(await _api.get('/geo/provinces/$provinceCode/cities'));
    return _cities[provinceCode] = list;
  }

  /// Barangays are names only - nothing here addresses one by code.
  Future<List<String>> barangays(String cityCode) async {
    if (_barangays.containsKey(cityCode)) return _barangays[cityCode]!;

    final body = await _api.get('/geo/cities/$cityCode/barangays');
    final list = body is List ? body.map((e) => e.toString()).toList() : <String>[];

    return _barangays[cityCode] = list;
  }
}

/// What is at a pinned spot, matched to the province, city and barangay
/// lists. Each part is empty when it could not be matched exactly, and the
/// person chooses it themselves.
class PinnedPlace {
  const PinnedPlace({
    required this.lat,
    required this.lng,
    this.found = false,
    this.display = '',
    this.province = '',
    this.provinceCode = '',
    this.city = '',
    this.cityCode = '',
    this.barangay = '',
    this.street = '',
  });

  final double lat;
  final double lng;
  final bool found;
  final String display;
  final String province;
  final String provinceCode;
  final String city;
  final String cityCode;
  final String barangay;
  final String street;

  /// One line for the screen: the matched parts, or OpenStreetMap's own words.
  String get summary {
    final parts = [street, barangay, city, province].where((p) => p.isNotEmpty).toList();
    if (parts.isNotEmpty) return parts.join(', ');
    return display;
  }

  factory PinnedPlace.fromJson(Map<String, dynamic> json, double lat, double lng) => PinnedPlace(
        lat: lat,
        lng: lng,
        found: json['found'] == true,
        display: (json['display'] ?? '').toString(),
        province: (json['province'] ?? '').toString(),
        provinceCode: (json['provinceCode'] ?? '').toString(),
        city: (json['city'] ?? '').toString(),
        cityCode: (json['cityCode'] ?? '').toString(),
        barangay: (json['barangay'] ?? '').toString(),
        street: (json['street'] ?? '').toString(),
      );
}

extension PinLookup on GeoService {
  /// What is at this spot. Never throws for a lookup that found nothing - the
  /// pin is still worth keeping without words.
  Future<PinnedPlace> whatIsAt(double lat, double lng) async {
    try {
      final body = await ApiClient.instance.get('/geo/reverse', query: {'lat': '$lat', 'lng': '$lng'});
      if (body is Map<String, dynamic>) return PinnedPlace.fromJson(body, lat, lng);
    } on ApiException {
      // Offline or the lookup service is down: the spot alone is returned.
    }
    return PinnedPlace(lat: lat, lng: lng);
  }
}
