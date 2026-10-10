import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVercelOrigin } from '../src/utils/corsOrigins.js';
import { escapeHtml } from '../src/utils/escapeHtml.js';

test('only this project\'s Vercel hosts pass CORS', () => {
  assert.equal(isVercelOrigin('https://agrifair.vercel.app', 'agrifair'), true);
  assert.equal(isVercelOrigin('https://agrifair-git-main-josh.vercel.app', 'agrifair'), true);

  // Anyone can deploy these.
  assert.equal(isVercelOrigin('https://evil.vercel.app', 'agrifair'), false);
  assert.equal(isVercelOrigin('https://agrifairx.vercel.app', 'agrifair'), false);
  assert.equal(isVercelOrigin('https://agrifair-x.vercel.app.evil.com', 'agrifair'), false);
  assert.equal(isVercelOrigin('http://agrifair.vercel.app', 'agrifair'), false);

  // No project configured: no wildcard at all.
  assert.equal(isVercelOrigin('https://agrifair.vercel.app', ''), false);
});

test('names in emails cannot carry markup', () => {
  assert.equal(
    escapeHtml('<a href="https://phish">Click</a>'),
    '&lt;a href=&quot;https://phish&quot;&gt;Click&lt;/a&gt;',
  );
  assert.equal(escapeHtml("O'Brien & Sons"), 'O&#39;Brien &amp; Sons');
  assert.equal(escapeHtml(undefined), '');
});
