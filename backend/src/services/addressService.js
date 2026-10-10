import { findUserByUserId } from '../repositories/userRepository.js';
import { locateArea } from './geocodeService.js';
import { normalizePhMobile } from './orderRules.js';

/**
 * A buyer's saved delivery addresses.
 *
 * The rule the whole thing rests on: exactly one address is the default, and
 * the list is never left without one. Checkout reads that default, so two of
 * them - or none - means it has to guess.
 */
function assertOneDefault(addresses) {
  if (!addresses.length) return;
  if (addresses.some((a) => a.isDefault)) return;

  // The list lost its default - the one marked was deleted. The first one
  // takes over rather than leaving checkout with nothing to preselect.
  addresses[0].isDefault = true;
}

/**
 * A coordinate, or null.
 *
 * Anything outside the real range is dropped rather than clamped: a bad
 * latitude is a bug somewhere upstream, and silently moving it to the pole
 * would hide that while still sending a rider somewhere.
 */
function coordinate(value, limit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < -limit || n > limit) return null;
  return n;
}

function clean(payload = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  return {
    lat: coordinate(payload.lat, 90),
    lng: coordinate(payload.lng, 180),
    label: text(payload.label) || 'Home',
    fullName: text(payload.fullName),
    contact: text(payload.contact),
    line: text(payload.line),
    barangay: text(payload.barangay),
    city: text(payload.city),
    province: text(payload.province),
    provinceCode: text(payload.provinceCode),
    cityCode: text(payload.cityCode),
    notes: text(payload.notes),
  };
}

/**
 * Gives an address a point when the buyer did not pin one.
 *
 * Where it is going has to come from the address they gave, not from where
 * anybody happens to be standing - a buyer ordering from school would
 * otherwise have their rice sent to school. Only the barangay, city and
 * province are looked up; the street line never is.
 *
 * Failure is silent and harmless: an address without a pin is still a
 * deliverable address, and the rider reads the words.
 */
async function fillAreaPin(fields, { pinnedByBuyer }) {
  // A pin sent with this request is the buyer standing at their own door.
  // Read from the request and not from the merged document: an approximate
  // pin already saved would otherwise be promoted to exact by any later edit
  // that only changed the label.
  if (pinnedByBuyer && fields.lat != null && fields.lng != null) {
    return { ...fields, precision: 'exact' };
  }

  const area = await locateArea({
    barangay: fields.barangay,
    city: fields.city,
    province: fields.province,
  });

  if (!area) return { ...fields, lat: null, lng: null, precision: '' };

  return { ...fields, lat: area.lat, lng: area.lng, precision: 'approximate' };
}

/** Checks the address and stores the number in the one form riders dial. */
function validate(fields) {
  if (!fields.fullName) throw new Error('Who is receiving this? Add a name.');
  if (!fields.contact) throw new Error('Add a contact number for the rider.');
  const mobile = normalizePhMobile(fields.contact);
  if (!mobile) throw new Error('Add a mobile number the rider can call, like 0917 123 4567.');
  fields.contact = mobile;
  if (!fields.line) throw new Error('Add the street or purok.');
  if (!fields.city) throw new Error('Add the city or municipality.');
}

export const addressService = {
  async list(userId) {
    const user = await findUserByUserId(userId);
    if (!user) throw new Error('User not found');

    return user.addresses || [];
  },

  async add(userId, payload) {
    const user = await findUserByUserId(userId);
    if (!user) throw new Error('User not found');

    const fields = await fillAreaPin(clean(payload), {
      pinnedByBuyer: payload.lat != null && payload.lng != null,
    });
    validate(fields);

    // The first address saved is the default whatever the caller asked for -
    // a list of one with no default would leave checkout empty.
    const makeDefault = payload.isDefault === true || user.addresses.length === 0;

    if (makeDefault) {
      for (const existing of user.addresses) {
        existing.isDefault = false;
      }
    }

    user.addresses.push({ ...fields, isDefault: makeDefault });
    assertOneDefault(user.addresses);
    await user.save();

    return user.addresses;
  },

  async update(userId, addressId, payload) {
    const user = await findUserByUserId(userId);
    if (!user) throw new Error('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new Error('Address not found');

    // Merged before locating, so editing only the barangay still moves the
    // pin - and re-locating on every edit keeps the point and the words from
    // drifting apart.
    const fields = await fillAreaPin(clean({ ...address.toObject(), ...payload }), {
      pinnedByBuyer: payload.lat != null && payload.lng != null,
    });
    validate(fields);

    address.set(fields);

    if (payload.isDefault === true) {
      for (const other of user.addresses) {
        other.isDefault = other._id.equals(address._id);
      }
    }

    assertOneDefault(user.addresses);
    await user.save();

    return user.addresses;
  },

  async remove(userId, addressId) {
    const user = await findUserByUserId(userId);
    if (!user) throw new Error('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new Error('Address not found');

    address.deleteOne();
    assertOneDefault(user.addresses);
    await user.save();

    return user.addresses;
  },
};
