import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/order.dart';
import 'package:mobile_app/models/seller.dart';
import 'package:mobile_app/services/seller_service.dart';

void main() {
  group('shop directory', () {
    test('loads shops, and every one has something to sell', () async {
      final shops = await SellerService.instance.shops();

      for (final shop in shops) {
        expect(shop.id, greaterThan(0));
        expect(shop.displayName, isNotEmpty);
        // A shop with nothing listed is not a shop a buyer can use, so the
        // directory should never carry one.
        expect(shop.productCount, greaterThan(0));
      }
    });

    test('a shop says which varieties it stocks', () async {
      final shops = await SellerService.instance.shops();
      if (shops.isEmpty) {
        markTestSkipped('no shops in the database');
        return;
      }

      expect(shops.first.varietyLine, isNotEmpty);
    });

    test('the variety line stays short when a shop stocks many', () {
      const many = ShopSummary(
        id: 1,
        name: 'Test Farm',
        isVerified: true,
        productCount: 5,
        totalSold: 0,
        varieties: ['Black Rice', 'Brown Rice', 'Jasmine', 'Red Rice'],
        fromPrice: 50,
        averageRating: 0,
        reviewCount: 0,
      );

      expect(many.varietyLine, 'Black Rice · Brown Rice +2');
    });
  });

  group('order stages', () {
    test('each server status lands in exactly one tab besides All', () {
      const statuses = [
        'pending',
        'confirmed',
        'processing',
        'shipped',
        'delivered',
        'completed',
        'cancelled',
      ];

      for (final status in statuses) {
        final tabs = OrderStage.statusTabs
            .where((s) => s != OrderStage.all && s.matches(status))
            .toList();

        expect(tabs, hasLength(1), reason: '$status landed in $tabs');
      }
    });

    test('Ongoing and History split every status between them', () {
      for (final status in ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled']) {
        final tabs = OrderStage.progressTabs.where((s) => s.matches(status)).toList();
        expect(tabs, hasLength(1), reason: '$status landed in $tabs');
      }
      expect(OrderStage.ongoing.matches('delivered'), isTrue);
      expect(OrderStage.history.matches('completed'), isTrue);
    });

    test('All takes everything', () {
      expect(OrderStage.all.matches('cancelled'), isTrue);
      expect(OrderStage.all.matches('shipped'), isTrue);
    });

    test('a cancelled order is found under Return', () {
      expect(OrderStage.returned.matches('cancelled'), isTrue);
    });

    test('an order is only as advanced as its least advanced item', () {
      final order = OrderGroup.fromJson({
        'groupId': 'g1',
        'orderNumber': 'AGF-001',
        'total': 100,
        'items': [
          {'productId': 'a', 'productName': 'A', 'status': 'shipped'},
          {'productId': 'b', 'productName': 'B', 'status': 'pending'},
        ],
      });

      // Half a shipment is not a shipment: this belongs under To Pay, not
      // To Receive, or the buyer is told their rice is coming when it is not.
      expect(order.status, 'pending');
      expect(OrderStage.toPay.matches(order.status), isTrue);
      expect(OrderStage.toReceive.matches(order.status), isFalse);
    });

    test('the item count adds up across lines', () {
      final order = OrderGroup.fromJson({
        'groupId': 'g1',
        'orderNumber': 'AGF-002',
        'status': 'confirmed',
        'total': 300,
        'items': [
          {'productId': 'a', 'productName': 'A', 'quantity': 2},
          {'productId': 'b', 'productName': 'B', 'quantity': 3},
        ],
      });

      expect(order.itemCount, 5);
    });
  });
}
