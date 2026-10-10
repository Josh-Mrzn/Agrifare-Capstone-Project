@Tags(['fixture'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/address.dart';
import 'package:mobile_app/services/address_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/auth_service.dart';
import 'package:mobile_app/services/cart_service.dart';
import 'package:mobile_app/services/checkout_service.dart';
import 'package:mobile_app/services/delivery_service.dart';
import 'package:mobile_app/services/order_service.dart';
import 'package:mobile_app/services/seller_service.dart';

/// Where an order is, between the shop and the door.
///
/// Needs the same verified buyer as the chat tests, a seller with stock, and
/// that seller's pickup point set - which is what "Pin my shop" does on the
/// web. To set it by hand:
///   db.users.updateOne({ userId: 6 }, { $set: {
///     pickupLat: 15.4863, pickupLng: 120.9670,
///     pickupAddress: 'Cabanatuan Public Market, Nueva Ecija' } })
///
///   flutter test --tags fixture --run-skipped -j 1
const _email = 'chat@agrifair.invalid';
const _password = 'chatpass123';

// Somewhere in Cabanatuan, far enough from the seller's pin that a straight
// line between them is a real distance rather than rounding noise.
const _doorLat = 15.4900;
const _doorLng = 120.9720;

void main() {
  final addresses = AddressService.instance;
  final orders = OrderService.instance;
  final delivery = DeliveryService.instance;

  late int sellerUserId;

  setUpAll(() async {
    await AuthService.instance.signIn(email: _email, password: _password);

    final shops = await SellerService.instance.shops();
    expect(shops, isNotEmpty, reason: 'no shop with stock to order from');
    sellerUserId = shops.first.id;
  });

  tearDownAll(() async => ApiClient.instance.clearToken());

  /// Places one order from a pinned address and hands back its row id.
  Future<({String orderId, String orderNumber})> placeOrder({
    required bool pinned,
  }) async {
    final products = await SellerService.instance.products(sellerUserId);
    final product = products.firstWhere(
      (p) => p.firstAvailableOption != null,
      orElse: () => throw StateError('the seller has no orderable stock'),
    );

    final cart = CartService.instance;
    await cart.clear();
    await cart.add(
      productId: product.id,
      weightKg: product.firstAvailableOption!.weightKg,
      quantity: 1,
    );

    // Start from nothing so a leftover address from another run cannot decide
    // whether this one is pinned.
    for (final existing in await addresses.list()) {
      await addresses.remove(existing.id);
    }

    final saved = await addresses.add(
      Address(
        id: '',
        label: 'Home',
        fullName: 'Chat Tester',
        contact: '09171234567',
        line: 'Blk 48 Lot 71',
        barangay: 'Bantug',
        city: 'Cabanatuan',
        province: 'Nueva Ecija',
        lat: pinned ? _doorLat : null,
        lng: pinned ? _doorLng : null,
        isDefault: true,
      ),
    );

    final address = saved.first;
    final placed = await CheckoutService.instance.placeOrder(
      customerName: address.fullName,
      customerContact: address.contact,
      deliveryAddress: address.formatted,
      paymentMethod: 'Cash/COD',
      addressId: address.id,
    );

    final group = await orders.byGroupId(placed.groupId);
    return (orderId: group.items.first.orderId, orderNumber: placed.orderNumber);
  }

  group('an address remembers its pin', () {
    test('coordinates survive the round trip to the server', () async {
      for (final existing in await addresses.list()) {
        await addresses.remove(existing.id);
      }

      final saved = await addresses.add(
        const Address(
          id: '',
          label: 'Home',
          fullName: 'Chat Tester',
          contact: '09171234567',
          line: 'Blk 48 Lot 71',
          city: 'Cabanatuan',
          province: 'Nueva Ecija',
          lat: _doorLat,
          lng: _doorLng,
          isDefault: true,
        ),
      );

      expect(saved.first.isPinned, isTrue);
      expect(saved.first.lat, closeTo(_doorLat, 0.00001));
      expect(saved.first.lng, closeTo(_doorLng, 0.00001));
    });

    test('an address with no pin is placed at its barangay, not left blank',
        () async {
      for (final existing in await addresses.list()) {
        await addresses.remove(existing.id);
      }

      final saved = await addresses.add(
        const Address(
          id: '',
          label: 'Home',
          fullName: 'Chat Tester',
          contact: '09171234567',
          // The kind of line that would geocode somewhere confident and wrong.
          // It is never sent to the geocoder - only the three fields below are.
          line: 'Blk 48 Lot 71 (white house po bahay namin)',
          barangay: 'Cristo Rey',
          city: 'Capas',
          province: 'Tarlac',
          isDefault: true,
        ),
      );

      final address = saved.first;

      expect(address.isPinned, isTrue);
      expect(address.isApproximate, isTrue);
      expect(address.isExact, isFalse);

      // Capas, Tarlac - roughly. Loose enough to survive the map data being
      // corrected, tight enough to fail if the pin lands in another province.
      expect(address.lat, closeTo(15.36, 0.25));
      expect(address.lng, closeTo(120.54, 0.25));
    });

    test('an address nowhere on the map is left without a pin', () async {
      for (final existing in await addresses.list()) {
        await addresses.remove(existing.id);
      }

      final saved = await addresses.add(
        const Address(
          id: '',
          label: 'Home',
          fullName: 'Chat Tester',
          contact: '09171234567',
          line: 'Somewhere',
          barangay: 'Zzqqxx',
          city: 'Zzqqxxwwvv',
          province: 'Zzqqxxwwvv',
          isDefault: true,
        ),
      );

      // Nothing is invented. The rider still has the written address.
      expect(saved.first.isPinned, isFalse);
      expect(saved.first.precision, isEmpty);
    });
  });

  group('an order knows both ends of its journey', () {
    late String orderId;
    late String orderNumber;

    setUpAll(() async {
      final placed = await placeOrder(pinned: true);
      orderId = placed.orderId;
      orderNumber = placed.orderNumber;
    });

    test('the destination is the pin from the address that was chosen',
        () async {
      final tracking = await delivery.track(orderId);

      expect(tracking.orderNumber, orderNumber);
      expect(tracking.dropoff.hasPoint, isTrue);
      expect(tracking.dropoff.lat, closeTo(_doorLat, 0.00001));
      expect(tracking.dropoff.lng, closeTo(_doorLng, 0.00001));
      expect(tracking.dropoff.address, isNotEmpty);
      // Marked exactly, so the map may show it as a door.
      expect(tracking.dropoff.isApproximate, isFalse);
    });

    test('the pickup is the seller shop, with words as well as a point',
        () async {
      final tracking = await delivery.track(orderId);

      expect(tracking.pickup.hasPoint, isTrue);
      expect(tracking.pickup.address, isNotEmpty);
    });

    test('there is enough to draw a map before any rider shares a position',
        () async {
      final tracking = await delivery.track(orderId);

      // The whole point: the two ends are known the moment the order exists.
      expect(tracking.hasCourier, isFalse);
      expect(tracking.hasMap, isTrue);
    });

    test('tracking is refused to somebody who is not on the order', () async {
      ApiClient.instance.clearToken();

      await expectLater(delivery.track(orderId), throwsA(isA<ApiException>()));

      await AuthService.instance.signIn(email: _email, password: _password);
    });
  });

  group('an order from an address the buyer never pinned', () {
    test('goes to the barangay of that address, and says the pin is approximate',
        () async {
      final placed = await placeOrder(pinned: false);
      final tracking = await delivery.track(placed.orderId);

      expect(tracking.pickup.hasPoint, isTrue);

      // The whole point of the change: where it goes comes from the address
      // that was given, not from where anybody happened to be standing.
      expect(tracking.dropoff.hasPoint, isTrue);
      expect(tracking.dropoff.isApproximate, isTrue);
      expect(tracking.dropoff.lat, closeTo(15.49, 0.3));

      expect(tracking.hasMap, isTrue);
      expect(tracking.dropoff.address, isNotEmpty);
    });
  });
}
