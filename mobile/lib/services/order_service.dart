import '../models/order.dart';
import 'api_client.dart';

class OrderService {
  OrderService._();

  static final OrderService instance = OrderService._();

  final _api = ApiClient.instance;

  /// Every order this buyer has placed. Fetched whole and filtered on the
  /// device: the tabs are views of one list, and refetching per tab would make
  /// switching between them feel slower than it is.
  Future<List<OrderGroup>> myOrders() async {
    final body = await _api.get('/buyer/orders');
    if (body is! List) return const [];

    return body
        .whereType<Map<String, dynamic>>()
        .map(OrderGroup.fromJson)
        .toList();
  }

  Future<OrderGroup> byGroupId(String groupId) async {
    final body = await _api.get('/buyer/orders/$groupId');
    return OrderGroup.fromJson(body as Map<String, dynamic>);
  }

  /// The buyer's confirmation that the rice arrived. It is the record of
  /// delivery and closes the order.
  Future<OrderGroup> confirmReceived(String groupId) async {
    final body = await _api.post('/buyer/orders/$groupId/received', {});
    return OrderGroup.fromJson(body as Map<String, dynamic>);
  }

  /// Opens a fresh PayMongo checkout for this order and returns its page.
  Future<String> startOnlinePayment(String groupId) async {
    final body = await _api.post('/buyer/orders/$groupId/paymongo', {});
    final url = body is Map ? body['checkoutUrl'] : null;
    if (url is! String || url.isEmpty) {
      throw ApiException('PayMongo did not return a payment page. Try again.');
    }
    return url;
  }

  /// Asks the server - which asks PayMongo - whether this order is paid.
  Future<bool> verifyOnlinePayment(String groupId) async {
    final body = await _api.post('/buyer/orders/$groupId/paymongo/verify', {});
    return body is Map && body['paid'] == true;
  }

  /// The server decides whether cancelling is still allowed; the app only
  /// hides the button when it already knows the answer is no.
  Future<String> cancel(String groupId, String reason) async {
    final body = await _api.post('/buyer/orders/$groupId/cancel', {
      'reason': reason,
    });

    if (body is Map && body['message'] != null) return body['message'].toString();
    return 'Order cancelled.';
  }
}
