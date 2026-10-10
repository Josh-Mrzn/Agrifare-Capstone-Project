import '../services/api_config.dart';
import 'api_client.dart';

/// One line of the server's cart.
///
/// A line is a product at one sack size. The same rice at 5 kg and at 50 kg is
/// two lines, because they are two purchases at two different per-kilo prices.
class ServerCartItem {
  const ServerCartItem({
    required this.productId,
    required this.sellerId,
    required this.name,
    required this.weightKg,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
    required this.inStock,
    required this.availableStock,
    required this.totalKg,
    this.variety = '',
    this.image = '',
    this.priceChanged = false,
  });

  final String productId;
  final int sellerId;
  final String name;
  final String variety;
  final String image;

  /// The sack size for this line.
  final double weightKg;

  /// How many sacks - not kilograms.
  final int quantity;

  /// What one sack costs at this weight, with the tier discount applied.
  final double unitPrice;
  final double lineTotal;

  /// What these sacks come to in stock terms.
  final double totalKg;

  final bool inStock;
  final double availableStock;

  /// True when the seller changed the price after this went in the cart.
  final bool priceChanged;

  String get imageUrl => ApiConfig.mediaUrl(image);

  String get weightLabel => weightKg % 1 == 0
      ? '${weightKg.toInt()} kg'
      : '${weightKg.toStringAsFixed(1)} kg';

  /// Identifies the line for updates and removals.
  String get key => '$productId@$weightKg';

  factory ServerCartItem.fromJson(Map<String, dynamic> json) {
    return ServerCartItem(
      productId: (json['productId'] ?? '').toString(),
      sellerId: (json['sellerId'] as num?)?.toInt() ?? 0,
      name: (json['name'] ?? '').toString(),
      variety: (json['variety'] ?? '').toString(),
      image: (json['image'] ?? '').toString(),
      weightKg: (json['weightKg'] as num?)?.toDouble() ?? 1,
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      unitPrice: (json['unitPrice'] as num?)?.toDouble() ?? 0,
      lineTotal: (json['lineTotal'] as num?)?.toDouble() ?? 0,
      totalKg: (json['totalKg'] as num?)?.toDouble() ?? 0,
      inStock: json['inStock'] != false,
      availableStock: (json['availableStock'] as num?)?.toDouble() ?? 0,
      priceChanged: json['priceChanged'] == true,
    );
  }
}

class ServerCart {
  const ServerCart({
    required this.items,
    required this.subtotal,
    required this.hasUnavailable,
    required this.unavailable,
    this.deliveryFee = 0,
    double? total,
  }) : _total = total;

  final List<ServerCartItem> items;
  final double subtotal;

  /// Worked out by the server: one fee per shop in the cart, each set by that
  /// seller. The app shows it and never computes or sends it.
  final double deliveryFee;
  final double? _total;

  /// Something in the cart sold out while it sat there.
  final bool hasUnavailable;
  final List<String> unavailable;

  bool get isEmpty => items.isEmpty;
  int get sackCount => items.fold(0, (sum, i) => sum + i.quantity);

  double get total => _total ?? subtotal + deliveryFee;

  static const empty = ServerCart(
    items: [],
    subtotal: 0,
    hasUnavailable: false,
    unavailable: [],
  );

  factory ServerCart.fromJson(Map<String, dynamic> json) {
    return ServerCart(
      items: (json['items'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .map(ServerCartItem.fromJson)
              .toList() ??
          const [],
      subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0,
      deliveryFee: (json['deliveryFee'] as num?)?.toDouble() ?? 0,
      total: (json['total'] as num?)?.toDouble(),
      hasUnavailable: json['hasUnavailable'] == true,
      unavailable:
          (json['unavailable'] as List?)?.map((e) => e.toString()).toList() ??
              const [],
    );
  }
}

/// The cart, kept on the server.
///
/// It used to live only in the app's memory, which meant checkout - reading
/// the server's cart - always found it empty. It also meant a cart vanished on
/// reinstall and never followed anyone to another device.
///
/// Every call returns the whole cart, rebuilt against live products, so a
/// price that moved or an item that sold out shows up without asking.
class CartService {
  CartService._();

  static final CartService instance = CartService._();

  final _api = ApiClient.instance;

  ServerCart _parse(dynamic body) {
    if (body is! Map<String, dynamic>) return ServerCart.empty;
    return ServerCart.fromJson(body);
  }

  Future<ServerCart> fetch() async => _parse(await _api.get('/cart'));

  Future<ServerCart> add({
    required String productId,
    required double weightKg,
    required int quantity,
  }) async {
    return _parse(await _api.post('/cart/items', {
      'productId': productId,
      'weightKg': weightKg,
      'quantity': quantity,
    }));
  }

  Future<ServerCart> setQuantity({
    required String productId,
    required double weightKg,
    required int quantity,
  }) async {
    return _parse(await _api.put('/cart/items/$productId', {
      'weightKg': weightKg,
      'quantity': quantity,
    }));
  }

  Future<ServerCart> remove({
    required String productId,
    required double weightKg,
  }) async {
    return _parse(
      await _api.delete('/cart/items/$productId?weightKg=$weightKg'),
    );
  }

  Future<ServerCart> clear() async => _parse(await _api.delete('/cart'));
}
