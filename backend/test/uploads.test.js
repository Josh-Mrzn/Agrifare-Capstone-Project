import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionFor } from '../src/middleware/multerMiddleware.js';
import { escapeRegex } from '../src/utils/escapeRegex.js';

const file = (mimetype, originalname) => ({ mimetype, originalname });

test('uploads keep an extension from the allowed list only', () => {
  assert.equal(extensionFor('images', file('image/png', 'a.png')), '.png');
  assert.equal(extensionFor('images', file('image/png', 'evil.html')), '.png');
  assert.equal(extensionFor('images', file('text/html', 'a.html')), undefined);
  assert.equal(extensionFor('paymentProof', file('image/svg+xml', 'a.svg')), undefined);
});

test('the phone app sends octet-stream, so the name decides from the same list', () => {
  assert.equal(extensionFor('images', file('application/octet-stream', 'IMG_1.JPG')), '.jpg');
  assert.equal(extensionFor('images', file('application/octet-stream', 'x.html')), undefined);
});

test('PDFs are allowed for documents and nothing else', () => {
  assert.equal(extensionFor('document', file('application/pdf', 'permit.pdf')), '.pdf');
  assert.equal(extensionFor('images', file('application/pdf', 'permit.pdf')), undefined);
});

test('search text matches literally', () => {
  assert.ok(new RegExp(escapeRegex('a.b')).test('xa.b'));
  assert.ok(!new RegExp(escapeRegex('a.b')).test('axb'));
  assert.doesNotThrow(() => new RegExp(escapeRegex('(')));
});
