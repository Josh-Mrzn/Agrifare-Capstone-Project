import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/conversation.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/chat_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/product_picker_sheet.dart';
import 'chat_screen.dart' show ChatAvatar, relativeTime;
import 'product_detail_screen.dart';
import 'seller_profile_screen.dart';

/// One conversation with one seller.
///
/// Opened from the inbox, or from a shop's Chat button before the two have
/// ever spoken - which is why it takes the other person's userId and not just
/// a conversation that may not exist yet.
class ConversationScreen extends StatefulWidget {
  const ConversationScreen({
    super.key,
    required this.otherUserId,
    required this.otherName,
    this.conversationId,
    this.otherAvatarUrl = '',
  });

  /// Null when the two have never spoken. The first sent message creates it.
  final String? conversationId;
  final int otherUserId;
  final String otherName;
  final String otherAvatarUrl;

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();

  List<ChatMessage> _messages = const [];
  String? _conversationId;
  String? _error;
  bool _loading = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _conversationId = widget.conversationId;
    _load();
  }

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final id = _conversationId;

    // Nothing to fetch before the first message - the conversation does not
    // exist yet, and asking for it would be a 404 the person cannot act on.
    if (id == null || id.isEmpty) {
      setState(() => _loading = false);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final messages = await ChatService.instance.messages(id);
      if (!mounted) return;
      setState(() {
        _messages = messages;
        _loading = false;
      });
      _scrollToLatest();
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  void _scrollToLatest() {
    // After the frame, or the list has no extent to scroll to yet.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send({String? imagePath, String? productId}) async {
    final text = _composer.text.trim();
    if ((text.isEmpty && imagePath == null && productId == null) || _sending) {
      return;
    }

    setState(() => _sending = true);

    try {
      final sent = await ChatService.instance.send(
        receiverUserId: widget.otherUserId,
        text: text,
        imagePath: imagePath,
        productId: productId,
      );

      if (!mounted) return;

      _composer.clear();
      setState(() {
        _sending = false;
        // The reply carries the conversation id, which is how a first message
        // turns a nameless screen into a real thread.
        _conversationId = sent.conversationId.isEmpty
            ? _conversationId
            : sent.conversationId;
        _messages = [..._messages, sent];
      });

      _scrollToLatest();
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  Future<void> _attach() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 70,
      maxWidth: 1600,
    );

    if (picked == null) return;
    await _send(imagePath: picked.path);
  }

  /// Which side of this conversation owns the listings.
  ///
  /// Only a seller has a shop, so the products on offer are always theirs -
  /// mine when I am the seller, the other person's when I am the buyer.
  int get _shopOwnerUserId {
    final me = UserModel.of(context).account;
    if (me?.role == 'seller') {
      return int.tryParse(me?.id ?? '') ?? widget.otherUserId;
    }
    return widget.otherUserId;
  }

  void _openProduct(String productId) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProductDetailScreen(productId: productId),
      ),
    );
  }

  Future<void> _sendProduct() async {
    final owner = _shopOwnerUserId;
    final isMine = owner != widget.otherUserId;

    final product = await showProductPicker(
      context,
      sellerUserId: owner,
      shopName: isMine ? 'Your shop' : widget.otherName,
    );

    if (product == null || !mounted) return;
    await _send(productId: product.id);
  }

  void _openShop() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SellerProfileScreen(
          sellerId: widget.otherUserId,
          initialName: widget.otherName,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
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
        titleSpacing: 0,
        title: GestureDetector(
          onTap: _openShop,
          behavior: HitTestBehavior.opaque,
          child: Row(
            children: [
              ChatAvatar(
                url: widget.otherAvatarUrl,
                initial: widget.otherName.trim().isEmpty
                    ? '?'
                    : widget.otherName.trim()[0].toUpperCase(),
                size: 34,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.otherName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                        color: AppColors.textDark,
                      ),
                    ),
                    const Text(
                      'Tap to view shop',
                      style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(child: _body()),
          _composerBar(),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
        children: const [
          ClaySkeleton(height: 46, width: 200),
          SizedBox(height: 12),
          ClaySkeleton(height: 46, width: 160),
          SizedBox(height: 12),
          ClaySkeleton(height: 62, width: 240),
        ],
      );
    }

    if (_error != null) {
      return ClayEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Cannot load this conversation',
        message: _error!,
        actionLabel: 'Try again',
        onAction: _load,
      );
    }

    if (_messages.isEmpty) {
      return ClayEmptyState(
        icon: Icons.waving_hand_rounded,
        title: 'Say hello',
        message: 'Ask ${widget.otherName} about their rice — how it was '
            'milled, when it was harvested, or how soon they can deliver.',
      );
    }

    final myUserId = int.tryParse(UserModel.of(context).account?.id ?? '') ?? 0;

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primaryMedium,
      child: ListView.builder(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
        itemCount: _messages.length,
        itemBuilder: (context, i) {
          final message = _messages[i];

          // An order update is nobody's turn - it sits across the thread
          // rather than on one side of it.
          if (message.isSystem) return _SystemNote(message: message);

          final mine = message.senderUserId == myUserId;

          // A run of messages from one person only needs the time on its last,
          // otherwise every bubble carries a timestamp nobody reads.
          final next = i + 1 < _messages.length ? _messages[i + 1] : null;
          final isLastOfRun = next == null ||
              next.isSystem ||
              next.senderUserId != message.senderUserId;

          return _Bubble(
            message: message,
            mine: mine,
            showTime: isLastOfRun,
            onOpenProduct: _openProduct,
          );
        },
      ),
    );
  }

  Widget _composerBar() {
    return Container(
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
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              ClayIconButton(
                icon: Icons.image_outlined,
                size: 42,
                onPressed: _sending ? null : _attach,
              ),
              const SizedBox(width: 7),
              ClayIconButton(
                icon: Icons.local_offer_outlined,
                size: 42,
                onPressed: _sending ? null : _sendProduct,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: TextField(
                  controller: _composer,
                  minLines: 1,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    hintText: 'Message',
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                  ),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _send(),
                ),
              ),
              const SizedBox(width: 9),
              _SendButton(
                enabled: _composer.text.trim().isNotEmpty && !_sending,
                sending: _sending,
                onTap: _send,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({
    required this.enabled,
    required this.sending,
    required this.onTap,
  });

  final bool enabled;
  final bool sending;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        height: 44,
        width: 44,
        decoration: BoxDecoration(
          color: enabled ? AppColors.primaryMedium : AppColors.surfaceSunken,
          shape: BoxShape.circle,
          boxShadow: enabled ? AppShadows.accent : null,
        ),
        child: sending
            ? const Padding(
                padding: EdgeInsets.all(13),
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  valueColor: AlwaysStoppedAnimation(Colors.white),
                ),
              )
            : Icon(
                Icons.arrow_upward_rounded,
                size: 21,
                color: enabled ? Colors.white : AppColors.textMuted,
              ),
      ),
    );
  }
}

/// An order speaking for itself, across the middle of the thread.
///
/// Deliberately not a bubble: it is neither person's words, and giving it a
/// side would put words in somebody's mouth.
class _SystemNote extends StatelessWidget {
  const _SystemNote({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.86,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: AppColors.surfaceSunken,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.receipt_long_rounded,
                    size: 15, color: AppColors.primaryMedium),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    message.text,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.4,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textBody,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    required this.mine,
    required this.showTime,
    required this.onOpenProduct,
  });

  final ChatMessage message;
  final bool mine;
  final bool showTime;
  final ValueChanged<String> onOpenProduct;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: showTime ? 12 : 3),
      child: Column(
        crossAxisAlignment:
            mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.75,
            ),
            child: Container(
              padding: message.hasMedia || message.product != null
                  ? const EdgeInsets.all(4)
                  : const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: mine ? AppColors.primaryMedium : AppColors.surface,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(AppRadius.md),
                  topRight: const Radius.circular(AppRadius.md),
                  // The corner nearest the sender is squared off, which is what
                  // makes a bubble point at whoever said it.
                  bottomLeft: Radius.circular(mine ? AppRadius.md : 4),
                  bottomRight: Radius.circular(mine ? 4 : AppRadius.md),
                ),
                boxShadow: mine ? null : AppShadows.subtle,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (message.product != null)
                    _ProductCard(
                      product: message.product!,
                      mine: mine,
                      onTap: () => onOpenProduct(message.product!.id),
                    ),
                  if (message.hasMedia)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      child: CachedNetworkImage(
                        imageUrl: message.mediaImageUrl,
                        fit: BoxFit.cover,
                        errorWidget: (_, _, _) => Container(
                          height: 140,
                          width: 200,
                          color: AppColors.surfaceSunken,
                          child: const Icon(
                            Icons.broken_image_outlined,
                            color: AppColors.textMuted,
                          ),
                        ),
                        placeholder: (_, _) =>
                            const ClaySkeleton(height: 140, width: 200),
                      ),
                    ),
                  if (message.text.isNotEmpty)
                    Padding(
                      padding: message.hasMedia || message.product != null
                          ? const EdgeInsets.fromLTRB(10, 8, 10, 6)
                          : EdgeInsets.zero,
                      child: Text(
                        message.text,
                        style: TextStyle(
                          fontSize: 14,
                          height: 1.4,
                          color: mine ? Colors.white : AppColors.textBody,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (showTime && message.sentAt != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
              child: Text(
                relativeTime(message.sentAt!),
                style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

/// A listing passed across, inside a bubble.
///
/// Tappable, because the point of sending it is that the other person can look
/// at the real thing rather than take a description on trust.
class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.product,
    required this.mine,
    required this.onTap,
  });

  final ChatProduct product;
  final bool mine;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 218,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 118,
              width: double.infinity,
              child: product.imageUrl.isEmpty
                  ? Container(
                      color: AppColors.surfaceSunken,
                      child: const Icon(Icons.rice_bowl_rounded,
                          size: 30, color: AppColors.primaryLight),
                    )
                  : CachedNetworkImage(
                      imageUrl: product.imageFullUrl,
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) => Container(
                        color: AppColors.surfaceSunken,
                        child: const Icon(Icons.rice_bowl_rounded,
                            size: 30, color: AppColors.primaryLight),
                      ),
                      placeholder: (_, _) => const ClaySkeleton(height: 118),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 9, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                      color: AppColors.textDark,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '₱${product.pricePerKg.toStringAsFixed(0)} per kg',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryMedium,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    // Stock is the thing being asked about most of the time,
                    // so it goes on the card rather than a tap away.
                    product.inStock
                        ? '${product.stock} kg left'
                        : 'Out of stock',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: product.inStock
                          ? AppColors.textMuted
                          : AppColors.error,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
