import 'dart:math';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/address.dart';
import '../models/cart.dart';
import '../services/address_service.dart';
import '../services/api_client.dart';
import '../services/checkout_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/private_image.dart';
import 'addresses_screen.dart';
import 'order_success_screen.dart';

/// Where to send it, how to pay, and - for GCash - proof that it was paid.
///
/// The receipt travels with the order rather than being uploaded afterwards.
/// A GCash order with no proof is one the seller cannot act on, and asking for
/// it in a second step is how it gets skipped.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _referenceController = TextEditingController();
  final _notesController = TextEditingController();

  Address? _address;
  PaymentMethod _method = PaymentMethod.cashOnDelivery;
  SellerPayment? _payment;
  File? _receipt;

  bool _loadingAddress = true;
  bool _loadingPayment = false;
  bool _placing = false;

  /// One per visit to this screen, sent with every press of Place order, so
  /// a retry after a dropped connection cannot place the order twice.
  final String _checkoutKey =
      '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  @override
  void initState() {
    super.initState();
    _loadDefaultAddress();

    // The order is built from the server's cart, so this screen reads it again
    // rather than trusting whatever the app happened to be holding - a stale
    // copy is how an order ends up priced on rice that has since sold out.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) CartModel.of(context).refresh();
    });
  }

  @override
  void dispose() {
    _referenceController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadDefaultAddress() async {
    try {
      final addresses = await AddressService.instance.list();
      if (!mounted) return;

      setState(() {
        _address = addresses.isEmpty
            ? null
            : addresses.firstWhere(
                (a) => a.isDefault,
                orElse: () => addresses.first,
              );
        _loadingAddress = false;
      });
    } on ApiException {
      if (!mounted) return;
      // A missing list is not a reason to block checkout - the person can
      // still add an address from here.
      setState(() => _loadingAddress = false);
    }
  }

  Future<void> _pickAddress() async {
    final chosen = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selecting: true)),
    );

    if (chosen == null || !mounted) return;
    setState(() => _address = chosen);
  }

  /// Loads the seller's GCash details the first time GCash is chosen.
  ///
  /// A basket can hold rice from several sellers, and each is paid separately.
  /// Until checkout splits per seller, this asks the first one - and says so
  /// on screen rather than quietly showing one seller's QR for the whole
  /// order.
  Future<void> _selectMethod(PaymentMethod method) async {
    setState(() => _method = method);

    if (method != PaymentMethod.gcash || _payment != null) return;

    final cart = CartModel.of(context);
    final sellerId = cart.items.isEmpty ? 0 : cart.items.first.sellerId;

    if (sellerId == 0) {
      setState(() => _payment = null);
      return;
    }

    setState(() => _loadingPayment = true);

    try {
      final payment = await AddressService.instance.paymentFor(sellerId);
      if (!mounted) return;
      setState(() {
        _payment = payment;
        _loadingPayment = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _loadingPayment = false);
      _notify(err.message);
    }
  }

  Future<void> _attachReceipt() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 70,
      maxWidth: 1600,
    );

    if (picked == null || !mounted) return;
    setState(() => _receipt = File(picked.path));
  }

  bool get _canPlace {
    if (_address == null || _placing) return false;

    // Nothing to buy: the server would refuse this anyway, and refusing it
    // here says so before the person taps.
    final cart = CartModel.of(context);
    if (!cart.isLoaded || cart.items.isEmpty) return false;

    // GCash without a receipt and its reference number leaves the seller
    // nothing to check against their own GCash history, so the button stays
    // disabled rather than creating an order they must chase.
    if (_method == PaymentMethod.gcash &&
        (_receipt == null || _referenceController.text.trim().isEmpty)) {
      return false;
    }

    return true;
  }

  Future<void> _placeOrder() async {
    if (!_canPlace) return;

    final cart = CartModel.of(context);
    final address = _address!;

    setState(() => _placing = true);

    try {
      final result = await CheckoutService.instance.placeOrder(
        customerName: address.fullName,
        customerContact: address.contact,
        deliveryAddress: [
          address.formatted,
          if (address.notes.isNotEmpty) '(${address.notes})',
        ].join(' '),
        paymentMethod: _method.wireValue,
        notes: _notesController.text.trim(),
        receiptPath: _receipt?.path,
        paymentReference: _referenceController.text.trim(),
        addressId: address.id,
        checkoutKey: _checkoutKey,
      );

      if (!mounted) return;

      // Read before clearing: the cart is emptied on the way out and the
      // success screen still has to show what was bought.
      final total = cart.total;
      cart.clear();

      // PayMongo's own page, in the browser. The order is saved already, so
      // a closed tab or a failed launch only means "Pay now" on the order.
      final checkoutUrl = result.checkoutUrl;
      if (checkoutUrl != null) {
        await launchUrl(
          Uri.parse(checkoutUrl),
          mode: LaunchMode.externalApplication,
        );
        if (!mounted) return;
      } else if (_method == PaymentMethod.paymongo) {
        _notify('Order placed. Open it under Orders and tap Pay now to pay.');
      }

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => OrderSuccessScreen(
            orderNumber: result.orderNumber,
            customerName: address.fullName,
            total: total,
            paymentMethod: _method.label,
            address: address.formatted,
          ),
        ),
        (route) => route.isFirst,
      );
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _placing = false);
      _notify(err.message);
    }
  }

  void _notify(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final cart = CartModel.of(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
          child: ClayIconButton(
            icon: Icons.arrow_back_rounded,
            size: 38,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ),
        leadingWidth: 62,
        title: const Text('Checkout'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
        children: [
          _addressSection(),
          const SizedBox(height: 16),
          _paymentSection(),
          const SizedBox(height: 16),
          _notesSection(),
          const SizedBox(height: 16),
          _summary(cart),
        ],
      ),
      bottomNavigationBar: _placeBar(cart),
    );
  }

  Widget _addressSection() {
    return ClayCard(
      onTap: _pickAddress,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const _Label('Deliver to'),
              const Spacer(),
              Text(
                _address == null ? 'Add' : 'Change',
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryMedium,
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: AppColors.primaryMedium,
              ),
            ],
          ),
          const SizedBox(height: 11),
          if (_loadingAddress)
            const ClaySkeleton(height: 44)
          else if (_address == null)
            const Text(
              'No address yet. Tap to add one and pin your door on the map.',
              style: TextStyle(
                fontSize: 13.5,
                color: AppColors.textMuted,
                height: 1.45,
              ),
            )
          else ...[
            Row(
              children: [
                Text(
                  _address!.fullName,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _address!.contact,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              _address!.formatted,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textBody,
                height: 1.45,
              ),
            ),
            if (!_address!.isExact) ...[
              const SizedBox(height: 6),
              const Text(
                'Not pinned on the map yet. Tap, then edit the address and pin your door, so the rider finds it.',
                style: TextStyle(fontSize: 12, height: 1.4, color: AppColors.warning),
              ),
            ],
            if (_address!.notes.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                _address!.notes,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textMuted,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _paymentSection() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('Payment'),
          const SizedBox(height: 12),
          for (final method in PaymentMethod.values) ...[
            _MethodRow(
              method: method,
              selected: _method == method,
              onTap: () => _selectMethod(method),
            ),
            if (method != PaymentMethod.values.last) const SizedBox(height: 9),
          ],
          if (_method == PaymentMethod.gcash) ...[
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 14),
            _gcashPanel(),
          ],
          if (_method == PaymentMethod.paymongo) ...[
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 14),
            const Text(
              'After you place the order, PayMongo\'s payment page opens. '
              'Choose GCash, Maya or card there.\n\n'
              'Sandbox demo: this is a test payment gateway. No real money '
              'is charged — tap "Authorize Test Payment" on the PayMongo page.',
              style: TextStyle(fontSize: 12.5, color: AppColors.textBody, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }

  Widget _gcashPanel() {
    if (_loadingPayment) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 22),
          child: CircularProgressIndicator(
            strokeWidth: 2.4,
            valueColor: AlwaysStoppedAnimation(AppColors.primaryMedium),
          ),
        ),
      );
    }

    final payment = _payment;

    if (payment == null || !payment.available) {
      return ClaySunken(
        child: Row(
          children: [
            const Icon(
              Icons.info_outline_rounded,
              size: 18,
              color: AppColors.warning,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                // Empty, not null, is what actually arrives when the server
                // sends no reason - and `??` does not catch an empty string,
                // which left this box blank with nothing to explain it.
                (payment?.reason ?? '').isEmpty
                    ? 'This seller has not set up online payment yet. '
                        'Choose Cash on Delivery instead.'
                    : payment!.reason,
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textBody,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Send the payment to ${payment.sellerName}',
          style: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
            color: AppColors.textDark,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (payment.hasQr) ...[
              GestureDetector(
                // A QR is scanned from another phone, so it has to be able to
                // get bigger than a 108px thumbnail.
                onTap: () => showPrivateImage(
                  context,
                  path: payment.qrImage,
                  title: 'GCash QR for ${payment.sellerName}',
                ),
                child: PrivateImage(
                  path: payment.qrImage,
                  height: 108,
                  width: 108,
                  fallbackIcon: Icons.qr_code_2_rounded,
                ),
              ),
              const SizedBox(width: 14),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (payment.accountName.isNotEmpty) ...[
                    const Text(
                      'Account name',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppColors.textMuted,
                      ),
                    ),
                    Text(
                      payment.accountName,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textDark,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  const Text(
                    'GCash number',
                    style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                  ),
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          payment.accountNumber,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textDark,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      // Typing an eleven-digit number into GCash by hand is
                      // where a payment goes to the wrong person.
                      GestureDetector(
                        onTap: () {
                          Clipboard.setData(
                            ClipboardData(text: payment.accountNumber),
                          );
                          _notify('Number copied');
                        },
                        child: const Icon(
                          Icons.copy_rounded,
                          size: 15,
                          color: AppColors.primaryMedium,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _referenceController,
          keyboardType: TextInputType.number,
          // Rebuilds so the Place order button notices the number.
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'GCash reference number',
            hintText: 'The Ref No. on your GCash receipt',
          ),
        ),
        const SizedBox(height: 12),
        _receiptPicker(),
      ],
    );
  }

  Widget _receiptPicker() {
    if (_receipt != null) {
      return ClaySunken(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: Image.file(
                _receipt!,
                height: 54,
                width: 54,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Receipt attached',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textDark,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'The seller checks this before confirming.',
                    style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: _attachReceipt,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primaryMedium,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text(
                'Change',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: _attachReceipt,
      child: DottedPanel(
        child: Column(
          children: [
            const Icon(
              Icons.receipt_long_rounded,
              size: 24,
              color: AppColors.primaryMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Upload your GCash receipt',
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textDark,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              'Pay first, then attach the screenshot',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textMuted.withValues(alpha: 0.9),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _notesSection() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Label('Note for the seller'),
          const SizedBox(height: 10),
          TextField(
            controller: _notesController,
            maxLines: 2,
            decoration: const InputDecoration(
              hintText: 'Optional — delivery time, anything else',
            ),
          ),
        ],
      ),
    );
  }

  Widget _summary(CartModel cart) {
    return ClayCard(
      child: Column(
        children: [
          _row('Subtotal', cart.subtotal),
          const SizedBox(height: 8),
          _row('Delivery', cart.deliveryFee),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text(
                'Total',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark,
                ),
              ),
              const Spacer(),
              Text(
                '₱${cart.total.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _row(String label, double value) {
    return Row(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 13.5, color: AppColors.textMuted),
        ),
        const Spacer(),
        Text(
          '₱${value.toStringAsFixed(0)}',
          style: const TextStyle(fontSize: 13.5, color: AppColors.textBody),
        ),
      ],
    );
  }

  /// Why the Place Order button is off, in the order the person hits them.
  String _reasonCannotPlace(CartModel cart) {
    if (!cart.isLoaded) return 'Loading your cart…';
    if (cart.items.isEmpty) return 'Your cart is empty — add rice to continue';
    if (_address == null) return 'Add a delivery address to continue';
    return 'Attach your GCash receipt to continue';
  }

  Widget _placeBar(CartModel cart) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
        boxShadow: [
          BoxShadow(
            color: Color(0x17122112),
            offset: Offset(0, -6),
            blurRadius: 18,
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Says why the button is off, instead of leaving someone tapping a
            // dead control and guessing.
            if (!_canPlace && !_placing) ...[
              Text(
                _reasonCannotPlace(cart),
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 10),
            ],
            ClayButton(
              label: 'Place Order  ·  ₱${cart.total.toStringAsFixed(0)}',
              isLoading: _placing,
              onPressed: _canPlace ? _placeOrder : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _MethodRow extends StatelessWidget {
  const _MethodRow({
    required this.method,
    required this.selected,
    required this.onTap,
  });

  final PaymentMethod method;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 170),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        decoration: BoxDecoration(
          color: selected ? AppColors.surfaceSunken : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(
            color: selected ? AppColors.primaryMedium : AppColors.border,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              switch (method) {
                PaymentMethod.gcash => Icons.qr_code_rounded,
                PaymentMethod.paymongo => Icons.credit_card_rounded,
                PaymentMethod.cashOnDelivery => Icons.payments_rounded,
              },
              size: 19,
              color: selected ? AppColors.primaryMedium : AppColors.textMuted,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                method.label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? AppColors.textDark : AppColors.textBody,
                ),
              ),
            ),
            Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
              size: 19,
              color: selected ? AppColors.primaryMedium : AppColors.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}

/// The seller's QR, loaded from the authenticated files route.
class DottedPanel extends StatelessWidget {
  const DottedPanel({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
      decoration: BoxDecoration(
        color: AppColors.surfaceSunken.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.primaryLight, width: 1.4),
      ),
      child: child,
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 10.5,
        fontWeight: FontWeight.w800,
        letterSpacing: 1.1,
        color: AppColors.textMuted,
      ),
    );
  }
}
