import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

/**
 * Philippine places (PSA's PSGC), read once into memory at startup: the three
 * files are half a megabyte together. Built by src/scripts/buildPsgc.js;
 * rebuild when the PSGC is republished.
 */
function load(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));
  } catch (err) {
    console.error(`[geo] could not read ${name}. Run: node src/scripts/buildPsgc.js`, err.message);
    return null;
  }
}

export const provinces = load('psgc-provinces.json') || [];
export const citiesByProvince = load('psgc-cities.json') || {};
export const barangaysByCity = load('psgc-barangays.json') || {};

/**
 * A place name reduced to what identifies it: no accents, no case, and none
 * of the words OpenStreetMap and the PSGC write differently ("City of
 * Cabanatuan" and "Cabanatuan City", "Poblacion (Bgy. 1)").
 */
export function normalizePlace(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(science city of|city of|municipality of|city|municipality|barangay|brgy|bgy|province of|province)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NCR_NAMES = ['metro manila', 'national capital region', 'ncr'];

function findProvince(candidates) {
  for (const raw of candidates) {
    const n = normalizePlace(raw);
    if (!n) continue;
    if (NCR_NAMES.includes(n)) return provinces.find((p) => p.code === 'NCR') || null;
    const hit = provinces.find((p) => normalizePlace(p.name) === n);
    if (hit) return hit;
  }
  return null;
}

function findCity(candidates, province) {
  const pools = province
    ? [[province.code, citiesByProvince[province.code] || []]]
    : Object.entries(citiesByProvince);
  for (const raw of candidates) {
    const n = normalizePlace(raw);
    if (!n) continue;
    const hits = [];
    for (const [provinceCode, cities] of pools) {
      for (const city of cities) {
        if (normalizePlace(city.name) === n) hits.push({ city, provinceCode });
      }
    }
    // Without a province, a name shared by two towns is not an answer.
    if (hits.length === 1 || (province && hits.length)) return hits[0];
  }
  return null;
}

function findBarangay(candidates, cityCode) {
  const list = barangaysByCity[cityCode] || [];
  for (const raw of candidates) {
    const n = normalizePlace(raw);
    if (!n) continue;
    const hit = list.find((b) => normalizePlace(b) === n);
    if (hit) return hit;
  }
  return '';
}

/**
 * Matches an OpenStreetMap address to the PSGC lists the address form uses,
 * so a pinned spot fills in the province, city and barangay pickers. Anything
 * that does not match exactly is left empty for the person to choose, rather
 * than guessed.
 */
export function matchAddress(address = {}) {
  const province = findProvince([address.province, address.state, address.county, address.region, address.state_district]);
  const city = findCity(
    [address.city, address.town, address.municipality, address.city_district, address.county],
    province,
  );
  const provinceRow = province || (city && provinces.find((p) => p.code === city.provinceCode)) || null;
  const barangay = city
    ? findBarangay([address.quarter, address.village, address.suburb, address.neighbourhood, address.hamlet, address.city_district], city.city.code)
    : '';
  const street = [address.house_number, address.road].filter(Boolean).join(' ');

  return {
    province: provinceRow?.name || '',
    provinceCode: provinceRow?.code || '',
    city: city?.city.name || '',
    cityCode: city?.city.code || '',
    barangay,
    street,
  };
}
