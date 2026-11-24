import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStem, tallinnIso, buildMarkdown, utf8ToBase64 } from '../lib/capture.mjs';

const WINTER = new Date('2026-11-24T16:05:09Z'); // Tallinn UTC+2
const SUMMER = new Date('2026-07-01T10:00:00Z'); // Tallinn UTC+3 (DST)

test('makeStem uses Tallinn wall-clock time in winter', () => {
  assert.equal(makeStem(WINTER, 'voice'), '2026-11-24-180509-voice');
});

test('makeStem uses Tallinn wall-clock time in summer (DST)', () => {
  assert.equal(makeStem(SUMMER, 'text'), '2026-07-01-130000-text');
});

test('makeStem rolls over the date at Tallinn midnight', () => {
  assert.equal(makeStem(new Date('2026-11-24T22:30:00Z'), 'photo'), '2026-11-25-003000-photo');
});

test('tallinnIso gives +02:00 in winter', () => {
  assert.equal(tallinnIso(WINTER), '2026-11-24T18:05:09+02:00');
});

test('tallinnIso gives +03:00 in summer', () => {
  assert.equal(tallinnIso(SUMMER), '2026-07-01T13:00:00+03:00');
});

test('buildMarkdown writes required keys and escapes strings as YAML-safe JSON', () => {
  const md = buildMarkdown({
    date: WINTER, source: 'share', text: 'Body',
    url: 'https://x.y/a?b=1', hint: 'for "Stoic": #1\nline2',
  });
  assert.equal(
    md,
    '---\ncaptured: 2026-11-24T18:05:09+02:00\nsource: share\nurl: "https://x.y/a?b=1"\nhint: "for \\"Stoic\\": #1\\nline2"\n---\n\nBody\n',
  );
});

test('buildMarkdown omits absent optional keys', () => {
  assert.equal(
    buildMarkdown({ date: WINTER, source: 'text', text: 'Hi' }),
    '---\ncaptured: 2026-11-24T18:05:09+02:00\nsource: text\n---\n\nHi\n',
  );
});

test('buildMarkdown writes image and photo_use for photos', () => {
  const md = buildMarkdown({
    date: WINTER, source: 'photo', text: '', image: '2026-11-24-180509-photo.jpg', photoUse: 'show',
  });
  assert.match(md, /\nimage: "2026-11-24-180509-photo\.jpg"\nphoto_use: show\n---\n/);
});

test('buildMarkdown keeps Estonian letters and emoji intact', () => {
  assert.match(buildMarkdown({ date: WINTER, source: 'text', text: 'Mõte 💡', hint: 'õäöü' }), /hint: "õäöü"[\s\S]*Mõte 💡/);
});

test('utf8ToBase64 encodes UTF-8, not Latin-1', () => {
  assert.equal(utf8ToBase64('Mõte 💡'), Buffer.from('Mõte 💡').toString('base64'));
});
