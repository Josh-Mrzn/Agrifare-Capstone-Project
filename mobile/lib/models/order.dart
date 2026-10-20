import '../services/api_config.dart';

/// Where an order sits, in the words a buyer uses rather than the server's.
///
/// The backend tracks seven statuses; a buyer thinks in fewer stages, so
/// several map onto one tab. `returned` collects cancellations too - whoever
/// called it off, the buyer is looking for the same thing: the order that did
/// not happen.
enum OrderStage {
  all('All'),
  toPay('To Pay'),
  toShip('To Ship'),
  toReceive('To Receive'),
  toReview('To Review'),
  returned('Return');

  const OrderStage(this.label);

  final String label;

  /// Which server statuses belong under this tab. Empty means every one.
  Set<String> get statuses {
    switch (this) {
      case OrderStage.all:
        return const {};
      case OrderStage.toPay:
        // Nothing is committed until a seller confirms, so this is where an
        // order waits for payment to be arranged.
        return const {'pending'};
      case OrderStage.toShip:
        return const {'confirmed', 'processing'};
      case OrderStage.toReceive:
        return const {'shipped'};
      case OrderStage.toReview:
        return const {'delivered', 'completed'};
      case OrderStage.returned:
        return const {'cancelled'};
    }
  }

  bool matches(String status) => statuses.isEmpty || statuses.contains(status);
}

class OrderItem {
  const OrderItem({
    required this.orderId,
    required this.sellerId,
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.unitPrice,
    required this.subtotal,
    required this.status,
    this.image = '',
    this.riderUserId,
    this.courierName = '',
  });

  /// This row's own id on the server.
  ///
  /// A basket is one order to the buyer but one row per line underneath, and
  /// delivery is tracked per row - each seller drives their own part of it
  /// from their own shop.
  final String orderId;
  final int sellerId;

  final String productId;
  final String productName;
  final int quantity;
  final double unitPrice;
  final double subtotal;
  final String status;
  final String image;

  /// The seller's delivery person on this line, when one is assigned.
  final int? riderUserId;
  final String courierName;

  String get imageUrl => ApiConfig.mediaUrl(image);

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    return OrderItem(
      orderId: (json['orderId'] ?? '').toString(),
      sellerId: (json['sellerId'] as num?)?.toInt() ?? 0,
      productId: (json['productId'] ?? '').toString(),
      productName: (json['productName'] ?? '').toString(),
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      unitPrice: (json['unitPrice'] as num?)?.toDouble() ?? 0,
      // The buyer's order rows call this `lineTotal`; reading only `subtotal`
      // found nothing and every item priced itself at zero.
      subtotal: ((json['lineTotal'] ?? json['subtotal']) as num?)?.toDouble() ?? 0,
      status: (json['status'] ?? 'pending').toString(),
      image: (json['image'] ?? json['productImage'] ?? '').toString(),
      riderUserId: (json['riderUserId'] as num?)?.toInt(),
      courierName: (json['courierName'] ?? '').toString(),
    );
  }
}

/// One checkout. A basket split across sellers becomes several rows on the
/// server but stays one order to the buyer, held together by `groupId`.
class OrderGroup {
  const OrderGroup({
    required this.groupId,
    required this.orderNumber,
    required this.status,
    required this.items,
    required this.total,
    required this.canCancel,
    this.canConfirmReceived = false,
    this.deliveryFee = 0,
    this.paymentMethod = '',
    this.paymentStatus = '',
    this.paymentProof = '',
    this.paymentReference = '',
    this.deliveryAddress = '',
    this.orderDate,
    this.cancelNeedsApproval = false,
    this.cancellationRequested = false,
    this.problemOpen = false,
    this.canResubmitPayment = false,
    this.canReportProblem = false,
    this.paymentNote = '',
    this.cancellationNote = '',
    this.complaintNote = '',
    this.refundAmount,
    this.refundReference = '',
  });

  /// Cancelling now asks the seller rather than cancelling at once: money or
  /// a receipt is involved, or the seller has started.
  final bool cancelNeedsApproval;
  final bool cancellationRequested;
  final bool problemOpen;

  /// The seller could not find the GCash payment; a new receipt can be sent.
  final bool canResubmitPayment;
  final bool canReportProblem;
  final String paymentNote;
  final String cancellationNote;
  final String complaintNote;
  final double? refundAmount;
  final String refundReference;

  /// The delivery person carrying an open part of this order, if any.
  int? get riderUserId {
    for (final item in items) {
      if (item.riderUserId != null && {'confirmed', 'processing', 'shipped', 'delivered'}.contains(item.status)) {
        return item.riderUserId;
      }
    }
    return null;
  }

  String get riderName {
    for (final item in items) {
      if (item.riderUserId != null) return item.courierName;
    }
    return '';
  }

  final String groupId;
  final String orderNumber;

  /// The whole order's status. Where rows disagree, the earliest stage wins -
  /// an order is only shipped once every part of it is.
  final String status;
  final List<OrderItem> items;
  final double total;
  final bool canCancel;

  /// Something arrived and the server is waiting for the buyer to say so.
  final bool canConfirmReceived;
  final double deliveryFee;
  final String paymentMethod;
  final String paymentStatus;

  /// The GCash receipt the buyer uploaded, behind the authenticated files
  /// route. Empty for cash on delivery, and for a GCash order placed before
  /// receipts were required.
  final String paymentProof;
  final String paymentReference;

  bool get hasReceipt => paymentProof.isNotEmpty;
  final String deliveryAddress;
  final DateTime? orderDate;

  int get itemCount => items.fold(0, (sum, i) => sum + i.quantity);

  String get statusLabel {
    switch (status) {
      case 'pending':
        return 'Waiting for the seller';
      case 'confirmed':
        return 'Confirmed';
      case 'processing':
        return 'Being prepared';
      case 'shipped':
        return 'On the way';
      case 'delivered':
        return 'Delivered';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  factory OrderGroup.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(OrderItem.fromJson)
            .toList() ??
        const <OrderItem>[];

    return OrderGroup(
      groupId: (json['groupId'] ?? '').toString(),
      orderNumber: (json['orderNumber'] ?? '').toString(),
      status: (json['status'] ?? _earliestStage(items)).toString(),
      items: items,
      total: (json['total'] as num?)?.toDouble() ?? 0,
      canCancel: json['canCancel'] == true,
      canConfirmReceived: json['canConfirmReceived'] == true,
      deliveryFee: (json['deliveryFee'] as num?)?.toDouble() ?? 0,
      paymentMethod: (json['paymentMethod'] ?? '').toString(),
      paymentStatus: (json['paymentStatus'] ?? '').toString(),
      paymentProof: (json['paymentProof'] ?? '').toString(),
      paymentReference: (json['paymentReference'] ?? '').toString(),
      deliveryAddress: (json['deliveryAddress'] ?? '').toString(),
      orderDate: DateTime.tryParse((json['orderDate'] ?? '').toString()),
      cancelNeedsApproval: json['cancelNeedsApproval'] == true,
      cancellationRequested: json['cancellationRequested'] == true,
      problemOpen: json['problemOpen'] == true,
      canResubmitPayment: json['canResubmitPayment'] == true,
      canReportProblem: json['canReportProblem'] == true,
      paymentNote: (json['paymentNote'] ?? '').toString(),
      cancellationNote: (json['cancellationNote'] ?? '').toString(),
      complaintNote: (json['complaintNote'] ?? '').toString(),
      refundAmount: (json['refund'] is Map) ? ((json['refund']['amount'] as num?)?.toDouble()) : null,
      refundReference: (json['refund'] is Map) ? (json['refund']['reference'] ?? '').toString() : '',
    );
  }

  /// Falls back to the least advanced row when the server sends no group
  /// status: an order half-shipped is not a shipped order.
  static String _earliestStage(List<OrderItem> items) {
    if (items.isEmpty) return 'pending';

    const order = [
      'cancelled',
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'completed',
    ];

    return items
        .map((i) => i.status)
        .reduce((a, b) => order.indexOf(a) <= order.indexOf(b) ? a : b);
  }
}
