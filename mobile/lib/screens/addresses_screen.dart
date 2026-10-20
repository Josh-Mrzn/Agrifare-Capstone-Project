import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../models/address.dart';
import '../services/address_service.dart';
import '../services/api_client.dart';
import '../services/geo_service.dart';
import '../theme/app_theme.dart';
import '../widgets/clay.dart';
import '../widgets/place_picker.dart';
import 'pin_location_screen.dart';

/// Saved delivery addresses.
///
/// Opened on its own from Profile, or from checkout to pick one - hence
/// [selecting], which turns the rows into choices and pops with the one
/// tapped instead of just showing them.
class AddressesScreen extends StatefulWidget {
  const AddressesScreen({super.key, this.selecting = false});

  final bool selecting;

  @override
  State<AddressesScreen> createState() => _AddressesScreenState();
}

class _AddressesScreenState extends State<AddressesScreen> {
  List<Address> _addresses = const [];
  String? _error;
  bool _loading = true;
  bool _busy = false;

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
      final addresses = await AddressService.instance.list();
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _loading = false;
      });
      // From checkout with nothing saved: go straight to adding one.
      if (widget.selecting && addresses.isEmpty) unawaited(_openForm());
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.message;
        _loading = false;
      });
    }
  }

  Future<void> _openForm({Address? existing}) async {
    final result = await showModalBottomSheet<Address>(
      context: context,
      backgroundColor: AppColors.background,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      ),
      builder: (context) => _AddressForm(existing: existing),
    );

    if (result == null || !mounted) return;

    setState(() => _busy = true);

    try {
      final list = existing == null
          ? await AddressService.instance.add(result)
          : await AddressService.instance.update(existing.id, result);

      if (!mounted) return;
      final before = _addresses.map((a) => a.id).toSet();
      setState(() {
        _addresses = list;
        _busy = false;
      });
      // Added from checkout: that new address is the one to deliver to.
      if (widget.selecting && existing == null) {
        final added = list.where((a) => !before.contains(a.id)).toList();
        if (added.isNotEmpty) Navigator.of(context).pop(added.first);
      }
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _busy = false);
      _notify(err.message);
    }
  }

  Future<void> _makeDefault(Address address) async {
    if (address.isDefault || _busy) return;
    setState(() => _busy = true);

    try {
      final list = await AddressService.instance.makeDefault(address.id);
      if (!mounted) return;
      setState(() {
        _addresses = list;
        _busy = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _busy = false);
      _notify(err.message);
    }
  }

  Future<void> _remove(Address address) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
        ),
        title: const Text(
          'Remove this address?',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
        content: Text(
          '${address.label} — ${address.formatted}',
          style: const TextStyle(fontSize: 13.5, color: AppColors.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            style: TextButton.styleFrom(foregroundColor: AppColors.textMuted),
            child: const Text('Keep'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);

    try {
      final list = await AddressService.instance.remove(address.id);
      if (!mounted) return;
      setState(() {
        _addresses = list;
        _busy = false;
      });
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(() => _busy = false);
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
        title: Text(widget.selecting ? 'Choose address' : 'My Addresses'),
      ),
      body: _body(),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 16),
          child: ClayButton(
            label: 'Add a new address',
            icon: Icons.add_rounded,
            onPressed: _busy ? null : () => _openForm(),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 20),
        children: const [
          ClaySkeleton(height: 116, radius: AppRadius.lg),
          SizedBox(height: 12),
          ClaySkeleton(height: 116, radius: AppRadius.lg),
        ],
      );
    }

    if (_error != null) {
      return ClayEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Cannot load your addresses',
        message: _error!,
        actionLabel: 'Try again',
        onAction: _load,
      );
    }

    if (_addresses.isEmpty) {
      return const ClayEmptyState(
        icon: Icons.location_off_outlined,
        title: 'No saved addresses',
        message: 'Add one and it will be used for your orders.',
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primaryMedium,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 20),
        itemCount: _addresses.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, i) => _AddressCard(
          address: _addresses[i],
          selecting: widget.selecting,
          onTap: widget.selecting
              ? () => Navigator.of(context).pop(_addresses[i])
              : () => _makeDefault(_addresses[i]),
          onEdit: () => _openForm(existing: _addresses[i]),
          onRemove: () => _remove(_addresses[i]),
          onMakeDefault: () => _makeDefault(_addresses[i]),
        ),
      ),
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.address,
    required this.selecting,
    required this.onTap,
    required this.onEdit,
    required this.onRemove,
    required this.onMakeDefault,
  });

  final Address address;
  final bool selecting;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onRemove;
  final VoidCallback onMakeDefault;

  @override
  Widget build(BuildContext context) {
    return ClayCard(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(15, 14, 15, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                address.label.toLowerCase() == 'work'
                    ? Icons.business_rounded
                    : Icons.home_rounded,
                size: 16,
                color: AppColors.primaryMedium,
              ),
              const SizedBox(width: 7),
              Text(
                address.label,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(width: 8),
              if (address.isDefault)
                const ClayBadge(label: 'Default', compact: true),
              const Spacer(),
              if (selecting && address.isDefault)
                const Icon(
                  Icons.check_circle_rounded,
                  size: 19,
                  color: AppColors.primaryMedium,
                ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            address.fullName,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            address.contact,
            style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted),
          ),
          const SizedBox(height: 5),
          Text(
            address.formatted,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textBody,
              height: 1.4,
            ),
          ),
          if (address.notes.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              address.notes,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textMuted,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
          if (!selecting) ...[
            const SizedBox(height: 8),
            const Divider(height: 1),
            Row(
              children: [
                if (!address.isDefault)
                  TextButton(
                    onPressed: onMakeDefault,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primaryMedium,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text(
                      'Set as default',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                const Spacer(),
                TextButton(
                  onPressed: onEdit,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.textMuted,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Edit',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(
                  onPressed: onRemove,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.error,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Remove',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _AddressForm extends StatefulWidget {
  const _AddressForm({this.existing});

  final Address? existing;

  @override
  State<_AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends State<_AddressForm> {
  final _formKey = GlobalKey<FormState>();

  late final _label = TextEditingController(text: widget.existing?.label ?? 'Home');
  late final _fullName = TextEditingController(text: widget.existing?.fullName);
  late final _contact = TextEditingController(text: widget.existing?.contact);
  late final _line = TextEditingController(text: widget.existing?.line);


  late final _notes = TextEditingController(text: widget.existing?.notes);

  late String _province = widget.existing?.province ?? '';
  late String _provinceCode = widget.existing?.provinceCode ?? '';
  late String _city = widget.existing?.city ?? '';
  late String _cityCode = widget.existing?.cityCode ?? '';
  late String _barangay = widget.existing?.barangay ?? '';

  late bool _isDefault = widget.existing?.isDefault ?? false;

  /// The pinned door, when there is one.
  ///
  /// This is the half of an address a rider can actually navigate to. It stays
  /// null unless the buyer pins it - never derived from the words, because an
  /// address like "white house po bahay namin" geocodes somewhere confident
  /// and wrong.
  late double? _lat = widget.existing?.lat;
  late double? _lng = widget.existing?.lng;
  late String _precision = widget.existing?.precision ?? '';
  bool _pinning = false;

  @override
  void dispose() {
    for (final c in [_label, _fullName, _contact, _line, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;

    // The pickers are not form fields, so the validator above never sees them.
    if (_province.isEmpty || _city.isEmpty) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('Choose a province and a city first.')),
        );
      return;
    }

    Navigator.of(context).pop(
      Address(
        id: widget.existing?.id ?? '',
        label: _label.text.trim().isEmpty ? 'Home' : _label.text.trim(),
        fullName: _fullName.text.trim(),
        contact: _contact.text.trim(),
        line: _line.text.trim(),
        barangay: _barangay,
        city: _city,
        provinceCode: _provinceCode,
        cityCode: _cityCode,
        province: _province,
        notes: _notes.text.trim(),
        lat: _lat,
        lng: _lng,
        precision: _precision,
        isDefault: _isDefault,
      ),
    );
  }

  /// Pins the door on the map - from the phone's location or by moving the
  /// map - and fills in the parts of the address the pin answers.
  ///
  /// Only ever on a tap: the app does not reach for somebody's coordinates on
  /// its own.
  Future<void> _pinOnMap() async {
    if (_pinning) return;
    setState(() => _pinning = true);

    final place = await Navigator.of(context).push<PinnedPlace>(
      MaterialPageRoute(
        builder: (_) => PinLocationScreen(
          initial: _lat != null && _lng != null && _precision == 'exact' ? LatLng(_lat!, _lng!) : null,
        ),
      ),
    );
    if (!mounted) return;
    setState(() => _pinning = false);
    if (place == null) return;

    setState(() {
      _lat = place.lat;
      _lng = place.lng;
      _precision = 'exact';
      // Only what matched the official lists is filled in; the rest stays as
      // the buyer left it, to choose below.
      if (place.provinceCode.isNotEmpty) {
        _province = place.province;
        _provinceCode = place.provinceCode;
      }
      if (place.cityCode.isNotEmpty) {
        _city = place.city;
        _cityCode = place.cityCode;
        _barangay = place.barangay;
      }
      if (_line.text.trim().isEmpty && place.street.isNotEmpty) _line.text = place.street;
    });

    final filled = place.cityCode.isNotEmpty;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(filled
            ? 'Pinned. Check the details below and add your house number and landmark.'
            : 'Pinned. Choose your province, city and barangay below.'),
      ));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Lifts the sheet clear of the keyboard, or the last fields sit under it.
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (context, controller) => Form(
          key: _formKey,
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
            children: [
              Center(
                child: Container(
                  height: 4,
                  width: 40,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSunken,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                widget.existing == null ? 'New address' : 'Edit address',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 16),
              // First: one tap on the map fills in most of the form below.
              _pinRow(),
              const SizedBox(height: 16),
              _field(_label, 'Label', hint: 'Home, Work, Bahay ni Nanay'),
              const SizedBox(height: 12),
              _field(
                _fullName,
                'Full name',
                required: true,
                message: 'Who will receive this?',
              ),
              const SizedBox(height: 12),
              _field(
                _contact,
                'Contact number',
                required: true,
                message: 'The rider needs a number to call.',
                hint: '09XX XXX XXXX',
                keyboard: TextInputType.phone,
              ),
              const SizedBox(height: 12),
              PlacePickerField(
                label: 'Province',
                value: _province,
                load: () async {
                  final places = await GeoService.instance.provinces();
                  return places
                      .map((p) => PickedPlace(
                            name: p.name,
                            code: p.code,
                            oldName: p.oldName,
                          ))
                      .toList();
                },
                onPicked: (picked) => setState(() {
                  _province = picked.name;
                  _provinceCode = picked.code;
                  // The city and barangay below belonged to the old province.
                  // Keeping them would leave an address that does not exist.
                  _city = '';
                  _cityCode = '';
                  _barangay = '';
                }),
              ),
              const SizedBox(height: 12),
              PlacePickerField(
                label: 'City or municipality',
                value: _city,
                enabled: _provinceCode.isNotEmpty,
                disabledHint: 'Choose a province first',
                load: () async {
                  final places = await GeoService.instance.cities(_provinceCode);
                  return places
                      .map((c) => PickedPlace(
                            name: c.name,
                            code: c.code,
                            oldName: c.oldName,
                          ))
                      .toList();
                },
                onPicked: (picked) => setState(() {
                  _city = picked.name;
                  _cityCode = picked.code;
                  _barangay = '';
                }),
              ),
              const SizedBox(height: 12),
              PlacePickerField(
                label: 'Barangay',
                value: _barangay,
                enabled: _cityCode.isNotEmpty,
                disabledHint: 'Choose a city first',
                load: () async {
                  final names = await GeoService.instance.barangays(_cityCode);
                  return names.map((n) => PickedPlace(name: n)).toList();
                },
                onPicked: (picked) => setState(() => _barangay = picked.name),
              ),
              const SizedBox(height: 12),
              _field(
                _line,
                'House number and street',
                required: true,
                message: 'Which street or purok?',
                hint: 'Blk 48 Lot 71, Rizal St.',
              ),
              const SizedBox(height: 12),
              _field(
                _notes,
                'Landmark',
                hint: 'Optional — green gate beside the sari-sari store',
                lines: 2,
              ),
              const SizedBox(height: 16),
              ClaySunken(
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Use as my default address',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark,
                        ),
                      ),
                    ),
                    Switch(
                      value: _isDefault,
                      activeThumbColor: AppColors.primaryMedium,
                      onChanged: (v) => setState(() => _isDefault = v),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              ClayButton(label: 'Save address', onPressed: _save),
            ],
          ),
        ),
      ),
    );
  }

  /// Where this address sits on the map, and how sure we are of it.
  ///
  /// The barangay is worked out on the server from the province, city and
  /// barangay chosen above - nothing has to be tapped for that. The button is
  /// for the one case a barangay cannot cover: standing at the door and
  /// marking it exactly.
  ///
  /// The difference is spelled out rather than glossed, because "pinned" on
  /// its own would let a barangay centre pass for somebody's front door.
  Widget _pinRow() {
    final exact = _precision == 'exact';

    return ClaySunken(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                exact ? Icons.location_on_rounded : Icons.map_outlined,
                size: 19,
                color: exact ? AppColors.primaryMedium : AppColors.textMuted,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      exact ? 'Exact spot marked' : 'Located by barangay',
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      exact
                          ? 'The map points at this exact spot.'
                          : 'Pin your door on the map and the province, city and '
                              'barangay fill in by themselves. Without a pin, the rider '
                              'is sent to the barangay and follows your street and landmark.',
                      style: const TextStyle(
                        fontSize: 11.5,
                        height: 1.4,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          GestureDetector(
            onTap: _pinning ? null : _pinOnMap,
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                boxShadow: AppShadows.subtle,
              ),
              child: _pinning
                  ? const Center(
                      child: SizedBox(
                        height: 14,
                        width: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.primaryMedium,
                        ),
                      ),
                    )
                  : Text(
                      // Named for what it actually does. "Pin here" invited
                      // somebody ordering from school to mark the school.
                      exact
                          ? 'Move the pin on the map'
                          : 'Pin my location on the map',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primaryMedium,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    String? message,
    String? hint,
    TextInputType? keyboard,
    int lines = 1,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboard,
      maxLines: lines,
      textCapitalization: TextCapitalization.words,
      decoration: InputDecoration(labelText: label, hintText: hint),
      validator: required
          ? (v) => (v?.trim().isEmpty ?? true) ? message : null
          : null,
    );
  }
}
