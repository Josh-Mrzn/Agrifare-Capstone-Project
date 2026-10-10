import 'api_client.dart';

/// What comes back when an order is placed.
class PlacedOrder {
  const PlacedOrder({required this.orderNumber, required this.groupId});

  final String orderNumber;
  final String groupId;

  factory PlacedOrder.fromJson(Map<String, dynamic> json) {
    return PlacedOrder(
      orderNumber: (json['orderNumber'] ?? '').toString(),
      groupId: (json['groupId'] ?? '').toString(),
    );
  }
}

class CheckoutService {
  CheckoutService._();

  static final CheckoutService instance = CheckoutService._();

  final _api = ApiClient.instance;

  /// Places the order, carrying the GCash receipt with it when there is one.
  ///
  /// Sent as multipart in one request rather than creating the order and then
  /// attaching proof: a second call can fail on its own and leave an order the
  /// seller has no way to check.
  Future<PlacedOrder> placeOrder({
    required String customerName,
    required String customerContact,
    required String deliveryAddress,
    required String paymentMethod,
    String notes = '',
    String? receiptPath,
    String paymentReference = '',
    String addressId = '',
  }) async {
    final body = await _api.postMultipart(
      '/cart/checkout',
      fileField: 'paymentProof',
      filePath: receiptPath,
      fields: {
        'customerName': customerName,
        'customerContact': customerContact,
        'deliveryAddress': deliveryAddress,
        'paymentMethod': paymentMethod,
        if (notes.isNotEmpty) 'notes': notes,
        if (paymentReference.isNotEmpty) 'paymentReference': paymentReference,
        // The id, not the coordinates: the server reads the pin off the saved
        // address itself, so a client cannot send an order somewhere the buyer
        // never chose.
        if (addressId.isNotEmpty) 'addressId': addressId,
      },
    );

    if (body is! Map<String, dynamic>) {
      throw ApiException('The order was sent but the server said nothing back.');
    }

    return PlacedOrder.fromJson(body);
  }
}
