import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/cart.dart';
import '../models/product.dart';
import '../models/review.dart';
import '../services/api_client.dart';
import '../services/product_service.dart';
import '../services/review_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/weight_sheet.dart';
import '../widgets/product_carousel.dart';
import '../widgets/review_overview.dart';
import '../widgets/seller_card.dart';
import 'cart_screen.dart';
import 'product_reviews_screen.dart';
import 'seller_profile_screen.dart';

/// One listing, loaded by id.
///
/// Taking an id rather than a Product means every route in - the home grid, a
/// seller's shop, a notification - lands on the same fresh copy, with stock
/// and price as they are now instead of whatever the last screen cached.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Product? _product;
  ReviewSummary _reviews = ReviewSummary.empty;
  List<Product> _alsoLike = const [];
  String? _error;
  bool _loading = true;

  bool _addingToCart = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // The reviews are part of deciding whether to buy, so they arrive with
      // the product rather than after a second wait further down the page.
      final results = await Future.wait([
        ProductService.instance.byId(widget.productId),
        ReviewService.instance
            .forProduct(widget.productId)
            // A product still reads fine without its reviews; losing the whole
            // page because they failed would be the worse trade.
            .catchError((_) => ReviewSummary.empty),
      ]);

      final product = results[0] as Product;
      if (!mounted) return;

      setState(() {
        _reviews = results[1] as ReviewSummary;
        _product = product;
        // Start on the second tier where there is one: the smallest bag is
        // rarely what someone buying a sack of rice actually wants.
        _loading = false;
      });

      // Fetched after the page is on screen rather than held in front of it:
      // nobody is waiting on the row at the very bottom.
      _loadSuggestions(product);
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  /// Other rice worth looking at, once this one is being considered.
  ///
  /// Same variety first - someone reading about Jasmine is deciding between
  /// Jasmines - then anything else, so the row is never empty just because a
  /// seller listed only one of a kind. The product being read is excluded, and
  /// so is anything out of stock.
  Future<void> _loadSuggestions(Product product) async {
    try {
      final sameVariety = await ProductService.instance.list(
        variety: product.variety,
      );

      var pool = sameVariety
          .where((p) => p.id != product.id && p.inStock)
          .toList();

      if (pool.length < 4) {
        final everything = await ProductService.instance.list();
        final seen = {product.id, ...pool.map((p) => p.id)};

        pool = [
          ...pool,
          ...everything.where((p) => !seen.contains(p.id) && p.inStock),
        ];
      }

      pool.sort((a, b) {
        final byRating = b.averageRating.compareTo(a.averageRating);
        return byRating != 0 ? byRating : b.soldCount.compareTo(a.soldCount);
      });

      if (!mounted) return;
      setState(() => _alsoLike = pool.take(8).toList());
    } on ApiException {
      // A row of suggestions is the least of what this page is for.
    }
  }

  /// Asks for the size and count, then buys.
  ///
  /// The sheet is the only place a weight is chosen, so both buttons go
  /// through here and neither can act on a stale selection left on the page.
  Future<void> _addToCart({required bool thenOpenCart}) async {
    if (_addingToCart) return;

    final product = _product!;
    final cart = CartModel.of(context);

    final choice = await showWeightSheet(
      context,
      product: product,
      confirmLabel: thenOpenCart ? 'Buy Now' : 'Add to Cart',
    );

    if (choice == null || !mounted) return;

    setState(() => _addingToCart = true);

    try {
      await cart.addItem(product, choice.tier, choice.quantity);
      if (!mounted) return;
      setState(() => _addingToCart = false);

      if (thenOpenCart) {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const CartScreen()),
        );
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              '${choice.tier.label} × ${choice.quantity} added to your cart',
            ),
          ),
        );
    } on ApiException catch (err) {
      // The seller's stock is the server's to know - "Only 10 kg left" is
      // more use than anything this screen could guess.
      if (!mounted) return;
      setState(() => _addingToCart = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  void _openSeller() {
    final seller = _product?.seller;
    if (seller == null) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SellerProfileScreen(
          sellerId: seller.id,
          initialName: seller.displayName,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: _loading
          ? const _LoadingBody()
          : _error != null
              ? SafeArea(
                  child: Column(
                    children: [
                      _floatingBar(),
                      Expanded(
                        child: ClayEmptyState(
                          icon: Icons.wifi_off_rounded,
                          title: 'Could not load this product',
                          message: _error!,
                          actionLabel: 'Try again',
                          onAction: _load,
                        ),
                      ),
                    ],
                  ),
                )
              : _body(),
      bottomNavigationBar: _product == null ? null : _buyBar(),
    );
  }

  Widget _body() {
    final product = _product!;

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primaryMedium,
      child: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _hero(product)),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _titleRow(product),

                  // The seller sits between the price and the reviews: by here
                  // the buyer knows the cost and is deciding whether to trust
                  // whoever is selling it.
                  if (product.seller != null) ...[
                    const SizedBox(height: 22),
                    const _SectionHeading('Sold by'),
                    const SizedBox(height: 10),
                    SellerCard(seller: product.seller!, onTap: _openSeller),
                  ],

                  const SizedBox(height: 22),
                  const _SectionHeading('What buyers said'),
                  const SizedBox(height: 10),
                  ReviewOverview(
                    summary: _reviews,
                    onSeeAll: _reviews.isEmpty
                        ? null
                        : () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ProductReviewsScreen(
                                  productId: product.id,
                                  productName: product.name,
                                ),
                              ),
                            ),
                  ),

                  if (product.description.isNotEmpty) ...[
                    const SizedBox(height: 22),
                    const _SectionHeading('About this rice'),
                    const SizedBox(height: 10),
                    ClayCard(
                      child: Text(
                        product.description,
                        style: const TextStyle(
                          fontSize: 14,
                          color: AppColors.textBody,
                          height: 1.6,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),

          // Suggestions run edge to edge, so the row scrolls out of the screen
          // rather than stopping short inside the page's margins.
          if (_alsoLike.isNotEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 28),
                child: ProductCarousel(
                  title: 'You might also like',
                  subtitle: 'Other rice buyers looked at',
                  products: _alsoLike,
                  onTap: (product) => Navigator.of(context).pushReplacement(
                    MaterialPageRoute(
                      builder: (_) => ProductDetailScreen(productId: product.id),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _hero(Product product) {
    return Stack(
      children: [
        SizedBox(
          height: 300,
          width: double.infinity,
          child: product.primaryImageUrl.isEmpty
              ? Container(
                  color: AppColors.surfaceSunken,
                  child: const Icon(
                    Icons.rice_bowl_outlined,
                    size: 64,
                    color: AppColors.primaryLight,
                  ),
                )
              : CachedNetworkImage(
                  imageUrl: product.primaryImageUrl,
                  fit: BoxFit.cover,
                  errorWidget: (_, _, _) => Container(
                    color: AppColors.surfaceSunken,
                    child: const Icon(
                      Icons.rice_bowl_outlined,
                      size: 64,
                      color: AppColors.primaryLight,
                    ),
                  ),
                  placeholder: (_, _) => Container(color: AppColors.surfaceSunken),
                ),
        ),
        // The page curves up over the photo, the way a clay surface would be
        // pressed onto it.
        Positioned(
          left: 0,
          right: 0,
          bottom: -1,
          child: Container(
            height: 32,
            decoration: const BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(AppRadius.xl),
              ),
            ),
          ),
        ),
        _floatingBar(),
        if (!product.inStock)
          const Positioned(
            left: 20,
            bottom: 44,
            child: ClayBadge(
              label: 'Out of stock',
              icon: Icons.remove_shopping_cart_rounded,
              color: AppColors.error,
            ),
          )
        else if (product.soldCount >= 100)
          Positioned(
            left: 20,
            bottom: 44,
            child: ClayBadge(
              label: 'Best Seller',
              icon: Icons.local_fire_department_rounded,
              color: AppColors.primaryMedium,
            ),
          ),
      ],
    );
  }

  Widget _floatingBar() {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            ClayIconButton(
              icon: Icons.arrow_back_rounded,
              onPressed: () => Navigator.of(context).pop(),
            ),
            AnimatedBuilder(
              animation: CartModel.of(context),
              builder: (context, _) => ClayIconButton(
                icon: Icons.shopping_cart_rounded,
                badge: CartModel.of(context).totalCount,
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CartScreen()),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _titleRow(Product product) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                product.name,
                style: const TextStyle(
                  fontSize: 25,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.7,
                  color: AppColors.textDark,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                product.variety,
                style: const TextStyle(
                  fontSize: 13.5,
                  color: AppColors.textMuted,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Row(
              children: [
                const Icon(Icons.star_rounded, size: 19, color: AppColors.accent),
                const SizedBox(width: 4),
                Text(
                  product.averageRating > 0
                      ? product.averageRating.toString()
                      : 'New',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textDark,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              product.soldCount > 0 ? '${product.soldCount} sold' : 'No sales yet',
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buyBar() {
    final product = _product!;
    final cheapest = product.firstAvailableOption;
    final canBuy = cheapest != null;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
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
            Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'From',
                      style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                    ),
                    Text(
                      // The cheapest sack that can actually be bought today,
                      // not a total for a purchase nobody has chosen yet.
                      cheapest == null
                          ? 'Sold out'
                          : '₱${cheapest.price.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontSize: 25,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.8,
                        color: AppColors.textDark,
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                Text(
                  cheapest == null
                      ? 'No sizes available'
                      : 'per ${cheapest.label} sack',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textMuted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: ClayButton(
                    label: 'Add to Cart',
                    filled: false,
                    isLoading: _addingToCart,
                    onPressed: canBuy && !_addingToCart
                        ? () => _addToCart(thenOpenCart: false)
                        : null,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ClayButton(
                    label: 'Buy Now',
                    onPressed: canBuy && !_addingToCart
                        ? () => _addToCart(thenOpenCart: true)
                        : null,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
        color: AppColors.textDark,
      ),
    );
  }
}

class _LoadingBody extends StatelessWidget {
  const _LoadingBody();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.zero,
      children: const [
        ClaySkeleton(height: 300, radius: 0),
        Padding(
          padding: EdgeInsets.fromLTRB(18, 22, 18, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClaySkeleton(height: 28, width: 220),
              SizedBox(height: 10),
              ClaySkeleton(height: 16, width: 120),
              SizedBox(height: 26),
              ClaySkeleton(height: 68, radius: AppRadius.md),
              SizedBox(height: 22),
              ClaySkeleton(height: 74, radius: AppRadius.lg),
              SizedBox(height: 16),
              ClaySkeleton(height: 74, radius: AppRadius.lg),
            ],
          ),
        ),
      ],
    );
  }
}
