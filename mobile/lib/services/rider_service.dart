import 'dart:async';

import 'api_client.dart';
import 'delivery_service.dart';

/// One product line of a delivery.
class DeliveryItem {
  const DeliveryItem({
    required this.productName,
    required this.quantity,
    this.weightKg = 1,
  });

  final String productName;
  final int quantity;
  final double weightKg;

  String get label => '$quantity× $productName';

  factory DeliveryItem.fromJson(Map<String, dynamic> json) => DeliveryItem(
        productName: (json['productName'] ?? '').toString(),
        quantity: (json['quantity'] as num?)?.toInt() ?? 0,
        weightKg: (json['weightKg'] as num?)?.toDouble() ?? 1,
      );
}

/// One trip a rider has been given: everything one shop sends to one buyer
/// from one checkout. The server keeps its lines together, so accepting,
/// starting and delivering apply to all of them.
class Delivery {
  const Delivery({
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.items,
    required this.total,
    required this.customerName,
    required this.customerContact,
    required this.pickup,
    required this.dropoff,
    this.groupId = '',
    this.assignmentStatus = 'accepted',
    this.shopName = '',
    this.shopContact = '',
    this.sellerUserId,
    this.buyerUserId,
    this.paymentMethod = '',
    this.paymentStatus = '',
    this.isCod = false,
    this.amountToCollect = 0,
    this.cashCollected,
    this.notes = '',
    this.proofOfDelivery = '',
    this.deliveryNote = '',
    this.isLive = false,
    this.deliveredAt,
  });

  final String orderId;
  final String groupId;
  final String orderNumber;
  final String status;

  /// `assigned` waits for the rider's answer; `accepted` is theirs to carry.
  final String assignmentStatus;
  final List<DeliveryItem> items;
  final double total;
  final String customerName;
  final String customerContact;
  final String shopName;
  final String shopContact;
  final int? sellerUserId;
  final int? buyerUserId;
  final String paymentMethod;
  final String paymentStatus;
  final bool isCod;

  /// Cash to take at the door. Zero when it was paid online or by GCash.
  final double amountToCollect;
  final double? cashCollected;
  final String notes;

  final DeliveryPoint pickup;
  final DeliveryPoint dropoff;

  final String proofOfDelivery;
  final String deliveryNote;
  final bool isLive;
  final DateTime? deliveredAt;

  bool get isWaitingForAnswer => assignmentStatus == 'assigned';
  bool get isDone => status == 'delivered' || status == 'completed';
  bool get canStart => !isWaitingForAnswer && status == 'processing';
  bool get isOnTheWay => status == 'shipped';
  bool get hasProof => proofOfDelivery.isNotEmpty;
  bool get collectsCash => amountToCollect > 0;

  String get summary => items.map((i) => i.label).join(', ');

  factory Delivery.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(DeliveryItem.fromJson)
        .toList();

    return Delivery(
      orderId: (json['orderId'] ?? '').toString(),
      groupId: (json['groupId'] ?? '').toString(),
      orderNumber: (json['orderNumber'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      assignmentStatus: (json['assignmentStatus'] ?? 'accepted').toString(),
      items: items.isNotEmpty
          ? items
          : [
              DeliveryItem(
                productName: (json['productName'] ?? '').toString(),
                quantity: (json['quantity'] as num?)?.toInt() ?? 0,
              ),
            ],
      total: (json['total'] as num?)?.toDouble() ?? 0,
      customerName: (json['customerName'] ?? '').toString(),
      customerContact: (json['customerContact'] ?? '').toString(),
      shopName: (json['shopName'] ?? '').toString(),
      shopContact: (json['shopContact'] ?? '').toString(),
      sellerUserId: (json['sellerUserId'] as num?)?.toInt(),
      buyerUserId: (json['buyerUserId'] as num?)?.toInt(),
      paymentMethod: (json['paymentMethod'] ?? '').toString(),
      paymentStatus: (json['paymentStatus'] ?? '').toString(),
      isCod: json['isCod'] == true,
      amountToCollect: (json['amountToCollect'] as num?)?.toDouble() ?? 0,
      cashCollected: (json['cashCollected'] as num?)?.toDouble(),
      notes: (json['notes'] ?? '').toString(),
      pickup: DeliveryPoint.fromJson(json['pickup'] as Map<String, dynamic>?),
      dropoff: DeliveryPoint.fromJson(json['dropoff'] as Map<String, dynamic>?),
      proofOfDelivery: (json['proofOfDelivery'] ?? '').toString(),
      deliveryNote: (json['deliveryNote'] ?? '').toString(),
      isLive: json['isLive'] == true,
      deliveredAt: DateTime.tryParse((json['deliveredAt'] ?? '').toString()),
    );
  }
}

/// What a delivery rider can do.
///
/// Only orders assigned to them, and only those. Working for the seller is not
/// enough on its own - the assignment is what opens one.
class RiderService {
  RiderService._();

  static final RiderService instance = RiderService._();

  final _api = ApiClient.instance;

  Delivery _one(dynamic body) {
    if (body is! Map<String, dynamic>) {
      throw ApiException('The server did not send the delivery back.');
    }
    return Delivery.fromJson(body);
  }

  /// `history` lists what the rider has already delivered.
  Future<List<Delivery>> myDeliveries({bool history = false}) async {
    final body = await _api.get(
      '/riders/me/deliveries',
      query: {'scope': history ? 'history' : 'active'},
    );
    if (body is! List) return const [];

    return body
        .whereType<Map<String, dynamic>>()
        .map(Delivery.fromJson)
        .where((d) => d.orderId.isNotEmpty)
        .toList();
  }

  Future<Delivery> delivery(String orderId) async =>
      _one(await _api.get('/riders/me/deliveries/$orderId'));

  Future<Delivery> accept(String orderId) async =>
      _one(await _api.post('/riders/me/deliveries/$orderId/accept'));

  Future<void> decline(String orderId, String reason) async {
    await _api.post('/riders/me/deliveries/$orderId/decline', {'reason': reason});
  }

  /// Picked up at the shop and on the road.
  Future<Delivery> start(String orderId) async =>
      _one(await _api.post('/riders/me/deliveries/$orderId/start'));

  /// Where the rider is, while they are moving.
  Future<void> pushLocation(
    String orderId, {
    required double lat,
    required double lng,
    int? etaMinutes,
  }) async {
    await _api.put('/riders/me/deliveries/$orderId/location', {
      'lat': lat,
      'lng': lng,
      'etaMinutes': ?etaMinutes,
    });
  }

  /// The photo at the door. Saved on the order straight away; marking it
  /// delivered is the next, separate step.
  Future<Delivery> uploadProof(
    String orderId, {
    required String photoPath,
    String note = '',
  }) async {
    return _one(await _api.postMultipart(
      '/riders/me/deliveries/$orderId/proof',
      fileField: 'proof',
      filePath: photoPath,
      fields: {if (note.trim().isNotEmpty) 'note': note.trim()},
    ));
  }

  /// "Mark as delivered", with the cash collected for cash on delivery.
  ///
  /// Retried on a dropped connection (never on a refusal): the server treats
  /// a repeat as the same delivery, so a rider on one bar of signal can keep
  /// trying without recording it twice.
  Future<Delivery> markDelivered(
    String orderId, {
    double? cashCollected,
    String note = '',
    int attempts = 3,
  }) async {
    for (var attempt = 1;; attempt++) {
      try {
        return _one(await _api.post('/riders/me/deliveries/$orderId/delivered', {
          'cashCollected': ?cashCollected,
          if (note.trim().isNotEmpty) 'note': note.trim(),
        }));
      } on ApiException catch (err) {
        final network = err.statusCode == null;
        if (!network || attempt >= attempts) rethrow;
        await Future<void>.delayed(Duration(seconds: 2 * attempt));
      }
    }
  }
}
