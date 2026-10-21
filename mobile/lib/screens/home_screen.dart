import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/cart.dart';
import '../models/notification_model.dart';
import '../models/order.dart';
import '../models/product.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../services/product_service.dart';
import '../theme/app_theme.dart';
import '../widgets/agri_banner.dart';
import '../widgets/clay.dart';
import 'cart_screen.dart';
import 'notifications_screen.dart';
import 'orders_screen.dart';
import 'product_detail_screen.dart';

/// The storefront.
///
/// Across the top are three short notes about how buying here works, not an
/// offer: there is no promotions system behind this app, so a discount banner
/// would either be invented or sit empty.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Product> _products = const [];
  String _variety = RiceVariety.all.value;
  String? _error;
  bool _loading = true;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _load();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      NotificationModel.of(context).load();
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final products = await ProductService.instance.list(variety: _variety);

      if (!mounted) return;
      setState(() {
        _products = products;
        _loading = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  void _selectVariety(String value) {
    if (_variety == value) return;
    setState(() => _variety = value);
    _load();
  }

  /// Fills in the delivery address from the phone, on request.
  ///
  /// Only ever from a tap. A rice app that reaches for someone's coordinates
  /// on launch has not earned that, and the address is wanted for one reason -
  /// checkout needs it - so it is asked for where that is obvious.
  Future<void> _useMyLocation() async {
    if (_locating) return;
    setState(() => _locating = true);

    final result = await LocationService.instance.currentAddress();
    if (!mounted) return;

    setState(() => _locating = false);

    if (result.isOk) {
      UserModel.of(context).updateProfile(deliveryAddress: result.address);
      return;
    }

    // Blocked for good is the one case a retry cannot fix, so that message
    // comes with the way out rather than a dead "Try again".
    final blocked = result.outcome == LocationOutcome.deniedForever;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(result.message),
          duration: const Duration(seconds: 5),
          action: blocked
              ? SnackBarAction(
                  label: 'Settings',
                  textColor: Colors.white,
                  onPressed: LocationService.instance.openSettings,
                )
              : null,
        ),
      );
  }

  void _openProduct(Product product) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProductDetailScreen(productId: product.id),
      ),
    );
  }

  /// Only the varieties a seller has actually listed. A chip that filters to
  /// an empty screen is a dead end, so kinds nobody stocks are left out.
  List<RiceVariety> get _stockedVarieties {
    final present = _products.map((p) => p.variety).toSet();

    return RiceVariety.values
        .where((v) => v == RiceVariety.all || present.contains(v.value))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _load,
          color: AppColors.primaryMedium,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _header()),
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.only(top: 20),
                  child: AgriBannerStrip(),
                ),
              ),
              SliverToBoxAdapter(child: _varietyRow()),

              SliverToBoxAdapter(child: _gridHeading()),
              _grid(),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    final user = UserModel.of(context);
    final address = user.deliveryAddress.trim();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Hi, ${user.displayName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.4,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 3),
                GestureDetector(
                  onTap: _useMyLocation,
                  behavior: HitTestBehavior.opaque,
                  child: Row(
                    children: [
                      if (_locating)
                        const SizedBox(
                          height: 12,
                          width: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 1.8,
                            valueColor:
                                AlwaysStoppedAnimation(AppColors.primaryMedium),
                          ),
                        )
                      else
                        const Icon(
                          Icons.my_location_rounded,
                          size: 13,
                          color: AppColors.primaryMedium,
                        ),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(
                          _locating
                              ? 'Finding you...'
                              : address.isEmpty
                                  ? 'Use my location'
                                  : address,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: AppColors.textMuted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      if (!_locating && address.isNotEmpty) ...[
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.refresh_rounded,
                          size: 12,
                          color: AppColors.textMuted,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          AnimatedBuilder(
            animation: NotificationModel.of(context),
            builder: (context, _) {
              final unread = NotificationModel.of(context).unreadCount;
              return ClayIconButton(
                icon: Icons.notifications_none_rounded,
                size: 42,
                badge: unread,
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const NotificationsScreen(),
                    ),
                  );
                  if (context.mounted) {
                    NotificationModel.of(context).load();
                  }
                },
              );
            },
          ),
          const SizedBox(width: 8),
          // Orders: what is on its way, and everything bought before.
          ClayIconButton(
            icon: Icons.receipt_long_rounded,
            size: 42,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const OrdersScreen(
                  initialStage: OrderStage.ongoing,
                  stages: OrderStage.progressTabs,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          AnimatedBuilder(
            animation: CartModel.of(context),
            builder: (context, _) => ClayIconButton(
              icon: Icons.shopping_cart_rounded,
              size: 42,
              badge: CartModel.of(context).totalCount,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CartScreen()),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _varietyRow() {
    final varieties = _stockedVarieties;
    if (varieties.length <= 1) return const SizedBox(height: 8);

    return Padding(
      padding: const EdgeInsets.only(top: 26),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              'Varieties',
              style: TextStyle(
                fontSize: 16.5,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
                color: AppColors.textDark,
              ),
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 86,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              itemCount: varieties.length,
              separatorBuilder: (_, _) => const SizedBox(width: 14),
              itemBuilder: (context, i) => _VarietyDisc(
                variety: varieties[i],
                selected: _variety == varieties[i].value,
                onTap: () => _selectVariety(varieties[i].value),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _gridHeading() {
    if (_loading || _error != null) return const SizedBox(height: 24);

    final label = _variety.isEmpty
        ? 'All rice'
        : RiceVariety.values
            .firstWhere(
              (v) => v.value == _variety,
              orElse: () => RiceVariety.all,
            )
            .label;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 26, 20, 14),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 16.5,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(width: 8),
          if (_products.isNotEmpty)
            Text(
              '${_products.length}',
              style: const TextStyle(
                fontSize: 13.5,
                color: AppColors.textMuted,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    );
  }

  Widget _grid() {
    if (_loading) {
      return const SliverPadding(
        padding: EdgeInsets.symmetric(horizontal: 20),
        sliver: SliverToBoxAdapter(
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(child: ClaySkeleton(height: 210, radius: AppRadius.lg)),
                  SizedBox(width: 14),
                  Expanded(child: ClaySkeleton(height: 210, radius: AppRadius.lg)),
                ],
              ),
              SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: ClaySkeleton(height: 210, radius: AppRadius.lg)),
                  SizedBox(width: 14),
                  Expanded(child: ClaySkeleton(height: 210, radius: AppRadius.lg)),
                ],
              ),
            ],
          ),
        ),
      );
    }

    if (_error != null) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: ClayEmptyState(
          icon: Icons.wifi_off_rounded,
          title: 'Cannot reach the shop',
          message: _error!,
          actionLabel: 'Try again',
          onAction: _load,
        ),
      );
    }

    if (_products.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: ClayEmptyState(
          icon: Icons.storefront_outlined,
          title: 'Nothing here yet',
          message: _variety.isEmpty
              ? 'No seller has listed rice yet. Pull down to check again.'
              : 'No seller has listed rice of this kind yet. Try another variety.',
          actionLabel: _variety.isEmpty ? null : 'Show all rice',
          onAction: _variety.isEmpty ? null : () => _selectVariety(''),
        ),
      );
    }

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
          childAspectRatio: 0.72,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, i) => _ProductTile(
            product: _products[i],
            onTap: () => _openProduct(_products[i]),
          ),
          childCount: _products.length,
        ),
      ),
    );
  }
}

/// A round filter for one kind of rice, the way the wireframe shows
/// categories. The icon differs per variety so the row is scannable by shape
/// as well as by label.
class _VarietyDisc extends StatelessWidget {
  const _VarietyDisc({
    required this.variety,
    required this.selected,
    required this.onTap,
  });

  final RiceVariety variety;
  final bool selected;
  final VoidCallback onTap;

  static const _icons = {
    '': Icons.grid_view_rounded,
    'Jasmine': Icons.local_florist_rounded,
    'Sinandomeng': Icons.rice_bowl_rounded,
    'Brown Rice': Icons.eco_rounded,
    'Black Rice': Icons.circle_rounded,
    'Red Rice': Icons.spa_rounded,
    'Glutinous (Malagkit)': Icons.water_drop_rounded,
    'Other': Icons.more_horiz_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final icon = _icons[variety.value] ?? Icons.rice_bowl_rounded;

    return SizedBox(
      width: 66,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            onTap: onTap,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              height: 58,
              width: 58,
              decoration: BoxDecoration(
                color: selected ? AppColors.primaryMedium : AppColors.surface,
                shape: BoxShape.circle,
                boxShadow: selected ? AppShadows.accent : AppShadows.subtle,
              ),
              child: Icon(
                icon,
                size: 24,
                color: selected ? Colors.white : AppColors.primaryMedium,
              ),
            ),
          ),
          const SizedBox(height: 7),
          Text(
            variety.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? AppColors.primaryMedium : AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product, required this.onTap});

  final Product product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ClayCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      shadows: AppShadows.subtle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  child: product.primaryImageUrl.isEmpty
                      ? Container(
                          color: AppColors.surfaceSunken,
                          child: const Icon(
                            Icons.rice_bowl_outlined,
                            size: 34,
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
                              size: 34,
                              color: AppColors.primaryLight,
                            ),
                          ),
                          placeholder: (_, _) =>
                              Container(color: AppColors.surfaceSunken),
                        ),
                ),
                if (!product.inStock)
                  const Positioned(
                    top: 10,
                    left: 10,
                    child: ClayBadge(
                      label: 'Out of stock',
                      color: AppColors.error,
                      compact: true,
                    ),
                  )
                else if (product.soldCount >= 100)
                  const Positioned(
                    top: 10,
                    left: 10,
                    child: ClayBadge(label: 'Best Seller', compact: true),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(13, 11, 13, 13),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  product.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textDark,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(
                      Icons.star_rounded,
                      size: 13,
                      color: AppColors.accent,
                    ),
                    const SizedBox(width: 3),
                    Text(
                      product.averageRating > 0
                          ? '${product.averageRating}'
                          : 'New',
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.textMuted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (product.soldCount > 0) ...[
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '· ${product.soldCount} sold',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '₱${product.startingPrice.toStringAsFixed(0)}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryMedium,
                    letterSpacing: -0.4,
                  ),
                ),
                const Text(
                  'per kilo',
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
