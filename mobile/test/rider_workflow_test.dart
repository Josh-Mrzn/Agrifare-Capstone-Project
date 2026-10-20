import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile_app/models/order.dart';
import 'package:mobile_app/screens/rider_home_screen.dart' show deliveryStage;
import 'package:mobile_app/services/rider_service.dart';
import 'package:mobile_app/services/route_service.dart';

/// The rider's delivery as the server describes it, and the buyer's order
/// flags that drive the cancel, receipt and problem buttons. No network.
Map<String, dynamic> _delivery({
  String status = 'processing',
  String assignment = 'assigned',
  bool cod = true,
  num toCollect = 1300,
  String proof = '',
}) => {
      'orderId': 'o1',
      'groupId': 'g1',
      'orderNumber': 'AGF-1A2B3C',
      'status': status,
      'assignmentStatus': assignment,
      'items': [
        {'orderId': 'o1', 'productName': 'Dinorado (25 kg)', 'quantity': 1, 'weightKg': 25},
        {'orderId': 'o2', 'productName': 'Dinorado (5 kg)', 'quantity': 2, 'weightKg': 5},
      ],
      'total': 1300,
      'paymentMethod': cod ? 'Cash/COD' : 'GCash',
      'paymentStatus': cod ? 'unpaid' : 'paid',
      'isCod': cod,
      'amountToCollect': toCollect,
      'customerName': 'Buyer One',
      'customerContact': '09171234567',
      'buyerUserId': 10,
      'sellerUserId': 2,
      'shopName': 'Verified Shop',
      'pickup': {'lat': 15.48, 'lng': 120.96, 'address': 'Public Market'},
      'dropoff': {'lat': 15.49, 'lng': 120.97, 'address': '1 Rizal St', 'precision': 'exact'},
      'proofOfDelivery': proof,
    };

void main() {
  test('a new assignment waits for the rider and shows the cash to collect', () {
    final d = Delivery.fromJson(_delivery());
    expect(d.isWaitingForAnswer, isTrue);
    expect(d.canStart, isFalse);
    expect(d.collectsCash, isTrue);
    expect(d.amountToCollect, 1300);
    expect(d.items, hasLength(2));
    expect(d.summary, '1× Dinorado (25 kg), 2× Dinorado (5 kg)');
    expect(deliveryStage(d).$1, 'New: accept or decline');
  });

  test('accepted and packed: ready to pick up; on the way needs the photo first', () {
    final ready = Delivery.fromJson(_delivery(assignment: 'accepted'));
    expect(ready.canStart, isTrue);
    expect(deliveryStage(ready).$1, 'Ready to pick up');

    final road = Delivery.fromJson(_delivery(assignment: 'accepted', status: 'shipped'));
    expect(road.isOnTheWay, isTrue);
    expect(road.hasProof, isFalse);
    final withPhoto = Delivery.fromJson(_delivery(assignment: 'accepted', status: 'shipped', proof: '/api/files/p.png'));
    expect(withPhoto.hasProof, isTrue);
  });

  test('an order paid by GCash collects nothing at the door', () {
    final d = Delivery.fromJson(_delivery(cod: false, toCollect: 0, assignment: 'accepted'));
    expect(d.collectsCash, isFalse);
  });

  test('older servers without items still read as one line', () {
    final json = _delivery()..remove('items');
    json['productName'] = 'Jasmine';
    json['quantity'] = 3;
    final d = Delivery.fromJson(json);
    expect(d.items.single.label, '3× Jasmine');
  });

  test('without a road route the straight line is labelled as such', () {
    final route = RouteService.instance.straightLine(const LatLng(15.48, 120.96), const LatLng(15.49, 120.97));
    expect(route.isStraightLine, isTrue);
    expect(route.distanceMeters, greaterThan(1000));
    expect(route.distanceLabel, endsWith('km'));
    expect(route.durationSeconds, greaterThan(0));
  });

  test('Google Maps directions go to the stop, from the rider when known', () {
    final uri = RouteService.instance.googleMapsDirections(
      const LatLng(15.49, 120.97),
      from: const LatLng(15.48, 120.96),
    );
    expect(uri.host, 'www.google.com');
    expect(uri.queryParameters['destination'], '15.49,120.97');
    expect(uri.queryParameters['origin'], '15.48,120.96');
    expect(uri.queryParameters['travelmode'], 'driving');
  });

  test('the buyer order carries the cancel, receipt, problem and rider details', () {
    final order = OrderGroup.fromJson({
      'groupId': 'g1',
      'orderNumber': 'AGF-1A2B3C',
      'status': 'processing',
      'total': 1300,
      'canCancel': true,
      'cancelNeedsApproval': true,
      'canResubmitPayment': false,
      'canReportProblem': false,
      'paymentStatus': 'refund_due',
      'refund': {'amount': 1300, 'reference': '5555'},
      'items': [
        {'orderId': 'o1', 'sellerId': 2, 'productId': 'p', 'productName': 'Dinorado', 'quantity': 1, 'unitPrice': 1250, 'lineTotal': 1250, 'status': 'processing', 'riderUserId': 20, 'courierName': 'Rider Juan'},
      ],
    });
    expect(order.cancelNeedsApproval, isTrue);
    expect(order.riderUserId, 20);
    expect(order.riderName, 'Rider Juan');
    expect(order.refundAmount, 1300);
    expect(order.refundReference, '5555');
  });
}
