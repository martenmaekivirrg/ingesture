import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin } from '../lib/image.mjs';

test('fitWithin shrinks a landscape photo to 1600 px wide', () => {
  assert.deepEqual(fitWithin(4000, 3000), { w: 1600, h: 1200 });
});

test('fitWithin shrinks a portrait photo to 1600 px tall', () => {
  assert.deepEqual(fitWithin(3000, 4000), { w: 1200, h: 1600 });
});

test('fitWithin never upscales a small image', () => {
  assert.deepEqual(fitWithin(800, 600), { w: 800, h: 600 });
});

test('fitWithin rounds to whole pixels (S23 Ultra 12 MP frame)', () => {
  assert.deepEqual(fitWithin(4080, 3060), { w: 1600, h: 1200 });
  assert.deepEqual(fitWithin(4000, 1848), { w: 1600, h: 739 });
});
