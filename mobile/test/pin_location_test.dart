import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/services/geo_service.dart';

void main() {
  test('a pinned spot carries the matched province, city and barangay', () {
    final place = PinnedPlace.fromJson({
      'found': true,
      'display': 'Maharlika Highway, Aduas Centro, Cabanatuan, Nueva Ecija, Philippines',
      'province': 'Nueva Ecija',
      'provinceCode': '034900000',
      'city': 'City of Cabanatuan',
      'cityCode': '034903000',
      'barangay': 'Aduas Centro',
      'street': 'Maharlika Highway',
    }, 15.49, 120.97);
    expect(place.cityCode, '034903000');
    expect(place.summary, 'Maharlika Highway, Aduas Centro, City of Cabanatuan, Nueva Ecija');
  });

  test('with nothing matched, the map\'s own words are shown', () {
    final place = PinnedPlace.fromJson({'found': true, 'display': 'Somewhere, Philippines'}, 15, 121);
    expect(place.cityCode, isEmpty);
    expect(place.summary, 'Somewhere, Philippines');
    expect(const PinnedPlace(lat: 1, lng: 2).summary, isEmpty);
  });
}
