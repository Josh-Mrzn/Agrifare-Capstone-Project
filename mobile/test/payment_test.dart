@Tags(['fixture'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/address.dart';
import 'package:mobile_app/services/address_service.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/auth_service.dart';
import 'package:mobile_app/services/cart_service.dart';
import 'package:mobile_app/services/checkout_service.dart';
import 'package:mobile_app/services/seller_service.dart';

/// What a buyer is told about paying a seller, and what they are never told.
///
/// A seller's GCash is invisible until a Super Admin approves it. Until then
/// the app must offer cash on delivery and say why - not show an empty box.
///
/// Needs the verified buyer from the chat tests, a seller in the shop
/// directory whose payout a Super Admin has approved, and one whose payout is
/// not approved. The second is named by id rather than searched for: the
/// directory only lists sellers with stock, and a seller can easily have an
/// unapproved payout without appearing there at all.
///
///   flutter test --tags fixture --run-skipped -j 1
const _email = 'chat@agrifair.invalid';
const _password = 'chatpass123';

/// A seller whose payout has not been approved. Any seller id will do as long
/// as their payout is not `verified`.
const _unapprovedSellerId = 2;

void main() {
  final sellers = SellerService.instance;
  final addresses = AddressService.instance;

  setUpAll(() async {
    await AuthService.instance.signIn(email: _email, password: _password);
  });

  tearDownAll(() async => ApiClient.instance.clearToken());

  /// A seller in the directory whose payout has been approved.
  Future<SellerPayment> approvedPayment() async {
    final shops = await sellers.shops();
    expect(shops, isNotEmpty);

    for (final shop in shops) {
      final payment = await addresses.paymentFor(shop.id);
      if (payment.available) return payment;
    }

    throw StateError(
      'no seller with an approved payout - approve one in Super Admin first',
    );
  }

  Future<SellerPayment> unapprovedPayment() async {
    final payment = await addresses.paymentFor(_unapprovedSellerId);
    expect(
      payment.available,
      isFalse,
      reason: 'seller $_unapprovedSellerId was approved - point this at another',
    );
    return payment;
  }

  group('a payout waiting on approval', () {
    test('never leaves the buyer with a blank explanation', () async {
      final payment = await unapprovedPayment();

      // The bug this covers: an empty reason rendered as an empty grey box,
      // so neither the buyer nor the seller could tell what was wrong.
      expect(payment.reason, isNotEmpty);
      expect(payment.reason.toLowerCase(), contains('cash on delivery'));
    });

    test('sends no account details at all', () async {
      final payment = await unapprovedPayment();

      // An unchecked QR could send money anywhere, so nothing is released
      // until somebody has looked at it.
      expect(payment.accountNumber, isEmpty);
      expect(payment.accountName, isEmpty);
      expect(payment.hasQr, isFalse);
    });
  });

  group('an approved payout', () {
    test('gives the buyer the account and the QR', () async {
      final payment = await approvedPayment();

      expect(payment.available, isTrue);
      expect(payment.accountNumber, isNotEmpty);
      expect(payment.sellerName, isNotEmpty);
      // Behind the authenticated files route, never a public URL.
      expect(payment.hasQr, isTrue);
      expect(payment.qrImage, startsWith('/api/files/'));
    });
  });

  group('who may open a private file', () {
    test('a buyer can open an approved seller\'s QR', () async {
      final payment = await approvedPayment();

      // Behind /api/files and refused without a token. It used to be refused
      // *with* one too - only the owner could read it - so the QR the buyer
      // has to scan came back 403 and the box was simply blank.
      final body = await ApiClient.instance.get(
        payment.qrImage.replaceFirst('/api', ''),
      );

      expect(body, isNotNull);
    });

    test('nobody can open it without signing in', () async {
      final payment = await approvedPayment();
      final path = payment.qrImage.replaceFirst('/api', '');

      ApiClient.instance.clearToken();
      await expectLater(
        ApiClient.instance.get(path),
        throwsA(isA<ApiException>()),
      );

      await AuthService.instance.signIn(email: _email, password: _password);
    });

    test('a receipt from an order that is not mine is refused', () async {
      // A real receipt exists in the seeded data; this account is on neither
      // side of the order that carries it.
      await expectLater(
        ApiClient.instance.get('/files/1788805676854-evhop0jd.jpg'),
        throwsA(isA<ApiException>()),
      );
    });
  });

  group('paying by GCash', () {
    test('is refused without a receipt, whatever the client sends', () async {
      final shops = await sellers.shops();
      final products = await sellers.products(shops.first.id);
      final product = products.firstWhere(
        (p) => p.firstAvailableOption != null,
        orElse: () => throw StateError('no orderable stock'),
      );

      final cart = CartService.instance;
      await cart.clear();
      await cart.add(
        productId: product.id,
        weightKg: product.firstAvailableOption!.weightKg,
        quantity: 1,
      );

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
          isDefault: true,
        ),
      );

      // The checkout screen disables the button, but the button is a courtesy.
      // The rule lives on the server, where it cannot be skipped.
      await expectLater(
        CheckoutService.instance.placeOrder(
          customerName: saved.first.fullName,
          customerContact: saved.first.contact,
          deliveryAddress: saved.first.formatted,
          paymentMethod: 'GCash',
          addressId: saved.first.id,
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message.toLowerCase(),
            'message',
            contains('receipt'),
          ),
        ),
      );
    });

    test('cash on delivery needs no receipt', () async {
      final addressList = await addresses.list();
      final address = addressList.first;

      final placed = await CheckoutService.instance.placeOrder(
        customerName: address.fullName,
        customerContact: address.contact,
        deliveryAddress: address.formatted,
        paymentMethod: 'Cash/COD',
        addressId: address.id,
      );

      expect(placed.orderNumber, isNotEmpty);
    });
  });
}
