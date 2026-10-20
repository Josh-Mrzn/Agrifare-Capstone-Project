import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAddress, normalizePlace } from '../src/geo/psgc.js';

// Address blocks shaped like OpenStreetMap's reverse geocoding answers.

test('place names compare without accents, case or "City of"', () => {
  assert.equal(normalizePlace('Science City of Muñoz'), 'munoz');
  assert.equal(normalizePlace('Cabanatuan City'), 'cabanatuan');
  assert.equal(normalizePlace('City of Cabanatuan'), 'cabanatuan');
  assert.equal(normalizePlace('Barangay 659'), '659');
});

test('a pin in Cabanatuan fills province, city and barangay', () => {
  const m = matchAddress({
    road: 'Maharlika Highway', village: 'Aduas Centro', city: 'Cabanatuan', state: 'Nueva Ecija', region: 'Central Luzon',
  });
  assert.equal(m.province, 'Nueva Ecija');
  assert.equal(m.provinceCode, '034900000');
  assert.equal(m.city, 'City of Cabanatuan');
  assert.equal(m.cityCode, '034903000');
  assert.equal(m.barangay, 'Aduas Centro');
  assert.equal(m.street, 'Maharlika Highway');
});

test('Muñoz matches with or without the accent', () => {
  const m = matchAddress({ quarter: 'Bantug', town: 'Munoz', state: 'Nueva Ecija' });
  assert.equal(m.city, 'Science City of Muñoz');
  assert.equal(m.barangay, 'Bantug');
});

test('Metro Manila has no province code but still matches', () => {
  const m = matchAddress({ suburb: 'Barangay 10', city: 'Manila', region: 'Metro Manila' });
  assert.equal(m.provinceCode, 'NCR');
  assert.equal(m.cityCode, '133900000');
  assert.equal(m.barangay, 'Barangay 10');
});

test('anything that does not match exactly is left empty, not guessed', () => {
  const m = matchAddress({ village: 'Nowhere Village', city: 'Cabanatuan', state: 'Nueva Ecija' });
  assert.equal(m.city, 'City of Cabanatuan');
  assert.equal(m.barangay, '');
  const none = matchAddress({ city: 'Atlantis' });
  assert.deepEqual([none.province, none.city, none.barangay], ['', '', '']);
});
