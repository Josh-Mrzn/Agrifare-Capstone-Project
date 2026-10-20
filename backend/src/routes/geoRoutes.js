import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { provinces, citiesByProvince, barangaysByCity } from '../geo/psgc.js';
import { reverseLookup } from '../services/geocodeService.js';

const router = express.Router();

const send = (res, data) => res.json({ success: true, data });

// Public: someone filling in a delivery address has not necessarily signed in
// yet, and there is nothing private about the list of Philippine towns.
router.get('/provinces', (req, res) => send(res, provinces));

router.get('/provinces/:code/cities', (req, res) => {
  const cities = citiesByProvince[req.params.code];

  if (!cities) {
    return res.status(404).json({
      success: false,
      message: 'No cities listed for that province.',
    });
  }

  return send(res, cities);
});

router.get('/cities/:code/barangays', (req, res) => {
  const barangays = barangaysByCity[req.params.code];

  if (!barangays) {
    return res.status(404).json({
      success: false,
      message: 'No barangays listed for that city or municipality.',
    });
  }

  return send(res, barangays);
});

/**
 * What is at a pinned spot, matched to the lists above: the buyer drops a pin
 * (or uses their location) and the address form fills itself in. Signed in
 * only, since every lookup goes out to OpenStreetMap.
 */
router.get('/reverse', protect, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ success: false, message: 'That is not a valid spot on the map.' });
  }
  return send(res, await reverseLookup(lat, lng));
});

/** Says whether the data was built, so a missing file is visible early. */
router.get('/', (req, res) =>
  send(res, {
    provinces: provinces.length,
    provincesWithCities: Object.keys(citiesByProvince).length,
    citiesWithBarangays: Object.keys(barangaysByCity).length,
    ready: provinces.length > 0,
  })
);

export default router;
