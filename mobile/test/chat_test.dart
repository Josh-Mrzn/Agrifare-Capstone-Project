@Tags(['fixture'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/services/api_client.dart';
import 'package:mobile_app/services/auth_service.dart';
import 'package:mobile_app/services/chat_service.dart';
import 'package:mobile_app/models/address.dart';
import 'package:mobile_app/models/conversation.dart';
import 'package:mobile_app/services/address_service.dart';
import 'package:mobile_app/services/cart_service.dart';
import 'package:mobile_app/services/checkout_service.dart';
import 'package:mobile_app/services/seller_service.dart';

/// Messages against a running backend.
///
/// Needs a verified buyer, and a seller with a listing that has enough stock
/// for at least one of the sack sizes they sell - a shop with 10 kg left and
/// only 25 kg and 50 kg on offer has nothing orderable, and the order test
/// will say so rather than passing on nothing.
///
/// Create the buyer, then mark it verified:
///   curl -X POST http://localhost:8080/api/auth/register \
///     -H "Content-Type: application/json" -H "x-client: mobile" \
///     -d '{"name":"Chat Tester","email":"chat@agrifair.invalid",
///          "password":"chatpass123","role":"buyer"}'
///
///   flutter test --tags fixture --run-skipped -j 1
const _email = 'chat@agrifair.invalid';
const _password = 'chatpass123';

void main() {
  final chat = ChatService.instance;
  final sellers = SellerService.instance;

  late int myUserId;
  late int sellerUserId;

  setUpAll(() async {
    final me = await AuthService.instance.signIn(
      email: _email,
      password: _password,
    );

    // Numeric, always - the app matches messages on this, and a Mongo id here
    // would make every assertion below pass or fail for the wrong reason.
    myUserId = int.parse(me.id);

    final shops = await sellers.shops();
    expect(
      shops,
      isNotEmpty,
      reason: 'no shop to message - seed a seller with a listing first',
    );
    sellerUserId = shops.first.id;
  });

  tearDownAll(() async => ApiClient.instance.clearToken());

  test('sending to a seller with no conversation yet creates one', () async {
    final sent = await chat.send(
      receiverUserId: sellerUserId,
      text: 'Magandang araw po, meron pa po ba kayong stock?',
    );

    expect(sent.conversationId, isNotEmpty);

    // The reply the server gives back must already say the message is mine.
    // It used to come back with a bare ObjectId, and the bubble landed on the
    // wrong side of the screen the moment it was sent.
    expect(sent.senderUserId, myUserId);
  });

  test('the seller then shows up in my inbox, named after them', () async {
    final conversations = await chat.conversations();
    expect(conversations, isNotEmpty);

    final other = conversations.first.otherThan(myUserId);
    expect(other, isNotNull);

    // Not me. This is the whole bug in one line: matched on the Mongo id, my
    // own row came back here.
    expect(other!.userId, isNot(myUserId));
    expect(other.userId, sellerUserId);
    expect(other.name, isNotEmpty);
  });

  test('my own messages never count as unread for me', () async {
    await chat.send(receiverUserId: sellerUserId, text: 'Salamat po!');

    final conversations = await chat.conversations();
    final mine = conversations.firstWhere(
      (c) => c.otherThan(myUserId)?.userId == sellerUserId,
    );

    // Unread means waiting on me. A message I just sent is waiting on them.
    expect(mine.unreadCount, 0);
    expect(mine.hasUnread, isFalse);
  });

  test('the inbox line says the last word was mine', () async {
    await chat.send(receiverUserId: sellerUserId, text: 'Reserve ko po');

    final conversations = await chat.conversations();
    final mine = conversations.firstWhere(
      (c) => c.otherThan(myUserId)?.userId == sellerUserId,
    );

    expect(mine.preview(myUserId), 'You: Reserve ko po');
  });

  test('opening the conversation returns the thread, oldest first', () async {
    final conversations = await chat.conversations();
    final mine = conversations.firstWhere(
      (c) => c.otherThan(myUserId)?.userId == sellerUserId,
    );

    final messages = await chat.messages(mine.id);
    expect(messages, isNotEmpty);

    // Every typed message belongs to one of the two people in the thread, and
    // at least one of them is mine.
    //
    // Not "all of them are mine": the seller replies, and order updates write
    // themselves in under the seller too. What matters is that attribution
    // lands on a real person - senderUserId 0 was the bug, and it made every
    // message render as the other side's.
    final typed = messages.where((m) => !m.isSystem).toList();
    expect(typed, isNotEmpty);
    expect(
      typed.every((m) => m.senderUserId == myUserId || m.senderUserId == sellerUserId),
      isTrue,
      reason: 'a message was attributed to nobody',
    );
    expect(typed.any((m) => m.senderUserId == myUserId), isTrue);

    final times = messages
        .where((m) => m.sentAt != null)
        .map((m) => m.sentAt!)
        .toList();
    final sorted = [...times]..sort();
    expect(times, sorted, reason: 'a thread is read top to bottom');
  });

  group('a listing sent across', () {
    test('arrives as a product card, not as an empty message', () async {
      final products = await sellers.products(sellerUserId);
      expect(products, isNotEmpty, reason: 'the seller has nothing to send');

      final sent = await chat.send(
        receiverUserId: sellerUserId,
        productId: products.first.id,
      );

      expect(sent.kind, MessageKind.product);
      expect(sent.product, isNotNull);
      expect(sent.product!.id, products.first.id);
      // The card carries what the question is usually about.
      expect(sent.product!.name, isNotEmpty);
      expect(sent.product!.stock, products.first.stock);
    });

    test('the inbox line names it', () async {
      final products = await sellers.products(sellerUserId);
      await chat.send(
        receiverUserId: sellerUserId,
        productId: products.first.id,
      );

      final conversations = await chat.conversations();
      final mine = conversations.firstWhere(
        (c) => c.otherThan(myUserId)?.userId == sellerUserId,
      );

      expect(mine.preview(myUserId), 'You shared ${products.first.name}');
    });

    test('a product that does not exist is refused', () async {
      await expectLater(
        chat.send(
          receiverUserId: sellerUserId,
          productId: '000000000000000000000000',
        ),
        throwsA(isA<ApiException>()),
      );
    });
  });

  group('an order speaks in the thread', () {
    test('placing one writes it into the conversation', () async {
      // A buyable sack from this seller, and somewhere to deliver it.
      final products = await sellers.products(sellerUserId);
      final product = products.firstWhere(
        (p) => p.firstAvailableOption != null,
        orElse: () => throw StateError('no seller stock to order'),
      );
      final option = product.firstAvailableOption!;

      final cart = CartService.instance;
      await cart.clear();
      await cart.add(
        productId: product.id,
        weightKg: option.weightKg,
        quantity: 1,
      );

      final addresses = AddressService.instance;
      final existing = await addresses.list();
      final address = existing.isNotEmpty
          ? existing.first
          : (await addresses.add(
              const Address(
                id: '',
                label: 'Home',
                fullName: 'Chat Tester',
                contact: '09171234567',
                line: '12 Purok Uno',
                barangay: 'Bantug',
                city: 'Cabanatuan',
                province: 'Nueva Ecija',
                isDefault: true,
              ),
            ))
              .first;

      final placed = await CheckoutService.instance.placeOrder(
        customerName: address.fullName,
        customerContact: address.contact,
        deliveryAddress: address.formatted,
        paymentMethod: 'Cash/COD',
      );

      final conversations = await chat.conversations();
      final mine = conversations.firstWhere(
        (c) => c.otherThan(myUserId)?.userId == sellerUserId,
      );

      final messages = await chat.messages(mine.id);
      final system = messages.where((m) => m.isSystem).toList();

      expect(system, isNotEmpty, reason: 'the order never announced itself');
      expect(system.last.text, contains(placed.orderNumber));
      expect(system.last.text.toLowerCase(), contains('placed'));
    });

    test('an order update never puts an unread badge on the buyer', () async {
      final conversations = await chat.conversations();
      final mine = conversations.firstWhere(
        (c) => c.otherThan(myUserId)?.userId == sellerUserId,
      );

      // The last word in the thread is the order's, and it is news rather than
      // a question - so there is nothing waiting on the buyer.
      expect(mine.lastMessage?.isSystem, isTrue);
      expect(mine.unreadCount, 0);
    });
  });

  test('nobody can start a conversation with themselves', () async {
    // A client that cannot work out who the other person is falls back to the
    // first participant - itself - and every reply then goes to the sender.
    // That is exactly what the seller's dashboard did, and it showed them
    // their own name as the person they were talking to.
    await expectLater(
      chat.send(receiverUserId: myUserId, text: 'talking to myself'),
      throwsA(isA<ApiException>()),
    );
  });

  test('someone else cannot read my conversation', () async {
    final conversations = await chat.conversations();
    final mine = conversations.first;

    ApiClient.instance.clearToken();

    await expectLater(
      chat.messages(mine.id),
      throwsA(isA<ApiException>()),
    );

    await AuthService.instance.signIn(email: _email, password: _password);
  });
}
