import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api_client.dart';
import '../services/review_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';

/// Rating one delivered order line.
///
/// Written against the order rather than the product, which is what makes the
/// result worth reading: the server accepts a review only from the buyer whose
/// order this was, only once it is completed, and only once. A competitor
/// cannot post one and neither can somebody who never bought the rice.
///
/// This screen used to be a mock - it waited 800ms and wrote to a list in
/// memory. Nothing a buyer wrote had ever reached the server, so no review had
/// ever appeared on a product.
class WriteReviewScreen extends StatefulWidget {
  const WriteReviewScreen({
    super.key,
    required this.orderId,
    required this.productName,
  });

  /// The order line being reviewed - not the product.
  final String orderId;
  final String productName;

  @override
  State<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends State<WriteReviewScreen> {
  static const _maxPhotos = 4;

  static const _ratingLabels = [
    '',
    'Poor',
    'Fair',
    'Good',
    'Very good',
    'Excellent',
  ];

  final _commentCtrl = TextEditingController();
  final List<File> _photos = [];

  int _rating = 0;
  bool _submitting = false;

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  void _notify(String message, {bool bad = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: bad ? AppColors.error : AppColors.primaryMedium,
        ),
      );
  }

  Future<void> _addPhotos() async {
    if (_photos.length >= _maxPhotos) return;

    final picked = await ImagePicker().pickMultiImage(
      imageQuality: 70,
      maxWidth: 1600,
    );
    if (picked.isEmpty || !mounted) return;

    setState(() {
      for (final file in picked) {
        if (_photos.length >= _maxPhotos) break;
        _photos.add(File(file.path));
      }
    });
  }

  Future<void> _submit() async {
    if (_rating == 0) {
      _notify('Choose a star rating first.', bad: true);
      return;
    }

    setState(() => _submitting = true);

    try {
      await ReviewService.instance.submit(
        orderId: widget.orderId,
        rating: _rating,
        comment: _commentCtrl.text,
        imagePaths: _photos.map((f) => f.path).toList(),
      );

      if (!mounted) return;
      _notify('Review posted. Salamat!');
      // true, so the list behind can reload and drop this from To Review.
      Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _submitting = false);
      _notify(err.message, bad: true);
    }
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
        title: const Text('Write a review'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
        children: [
          _productCard(),
          const SizedBox(height: 16),
          _ratingCard(),
          const SizedBox(height: 16),
          _commentCard(),
          const SizedBox(height: 16),
          _photosCard(),
        ],
      ),
      bottomNavigationBar: _submitBar(),
    );
  }

  Widget _productCard() {
    return ClayCard(
      child: Row(
        children: [
          const Icon(Icons.rice_bowl_rounded,
              size: 22, color: AppColors.primaryMedium),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'REVIEWING',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.1,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  widget.productName,
                  style: const TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textDark,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _ratingCard() {
    return ClayCard(
      child: Column(
        children: [
          const Text(
            'How was the rice?',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var star = 1; star <= 5; star++)
                GestureDetector(
                  onTap: () => setState(() => _rating = star),
                  behavior: HitTestBehavior.opaque,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    child: Icon(
                      star <= _rating
                          ? Icons.star_rounded
                          : Icons.star_outline_rounded,
                      size: 38,
                      color: star <= _rating
                          ? AppColors.accent
                          : AppColors.textMuted.withValues(alpha: 0.5),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            _rating == 0 ? 'Tap a star' : _ratingLabels[_rating],
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: _rating == 0 ? AppColors.textMuted : AppColors.primaryDark,
            ),
          ),
        ],
      ),
    );
  }

  Widget _commentCard() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tell other buyers',
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _commentCtrl,
            minLines: 4,
            maxLines: 7,
            maxLength: 1000,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText:
                  'Optional — how it cooked, how it smelled, how it arrived.',
            ),
          ),
        ],
      ),
    );
  }

  /// Photos are the part that makes a review checkable.
  ///
  /// A stranger's "maganda po" is worth little; a picture of the actual sack
  /// they received is something the next buyer can judge for themselves.
  Widget _photosCard() {
    return ClayCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Add photos',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                ),
              ),
              const Spacer(),
              Text(
                '${_photos.length} of $_maxPhotos',
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'A photo of the sack you actually received is what makes a review '
            'worth trusting.',
            style: TextStyle(
              fontSize: 12,
              height: 1.45,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (var i = 0; i < _photos.length; i++) _thumb(i),
              if (_photos.length < _maxPhotos) _addTile(),
            ],
          ),
        ],
      ),
    );
  }

  Widget _thumb(int index) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: Image.file(
            _photos[index],
            height: 78,
            width: 78,
            fit: BoxFit.cover,
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: GestureDetector(
            onTap: () => setState(() => _photos.removeAt(index)),
            behavior: HitTestBehavior.opaque,
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: const BoxDecoration(
                color: Colors.black54,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close_rounded,
                  size: 13, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  Widget _addTile() {
    return GestureDetector(
      onTap: _addPhotos,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 78,
        width: 78,
        decoration: BoxDecoration(
          color: AppColors.surfaceSunken.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: AppColors.primaryLight, width: 1.4),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_a_photo_outlined,
                size: 20, color: AppColors.primaryMedium),
            SizedBox(height: 4),
            Text(
              'Add',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _submitBar() {
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
            if (_rating == 0 && !_submitting) ...[
              const Text(
                'Choose a star rating to post',
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
              ),
              const SizedBox(height: 10),
            ],
            ClayButton(
              label: 'Post review',
              isLoading: _submitting,
              onPressed: _rating == 0 || _submitting ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}
