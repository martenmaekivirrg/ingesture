import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, enqueue, flush } from '../lib/queue.mjs';

const SETTINGS = { owner: 'o', repo: 'r', branch: 'main', token: 't', folder: 'inbox' };
const T1 = new Date('2026-11-24T16:05:09Z'); // stem 2026-11-24-180509-*
const T2 = new Date('2026-11-24T16:06:00Z'); // stem 2026-11-24-180600-*

const decode = (b64) => Buffer.from(b64, 'base64').toString('utf8');

// Fake uploader: answers each call from the script, defaulting to success.
function fakeUpload(script = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const answer = script[args.path]?.shift?.() ?? { ok: true, path: args.path };
    return typeof answer === 'function' ? answer(args) : answer;
  };
  fn.calls = calls;
  return fn;
}

test('a text capture is uploaded as inbox/<stem>.md and removed from the queue', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'text', text: 'Hello' });
  const up = fakeUpload();
  assert.deepEqual(await flush(store, up, SETTINGS), { sent: 1, left: 0, authError: false });
  assert.equal(up.calls[0].path, 'inbox/2026-11-24-180509-text.md');
  assert.match(decode(up.calls[0].contentB64), /source: text\n---\n\nHello\n$/);
  assert.equal(up.calls[0].message, 'ingesture: capture 2026-11-24-180509-text');
  assert.equal(up.calls[0].token, 't');
});

test('a network failure keeps the item unchanged for the next flush', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'voice', text: 'Idea' });
  const before = structuredClone(await store.all());
  const up = fakeUpload({ 'inbox/2026-11-24-180509-voice.md': [{ ok: false, kind: 'network' }] });
  assert.deepEqual(await flush(store, up, SETTINGS), { sent: 0, left: 1, authError: false });
  assert.deepEqual(await store.all(), before);
});

test('a photo uploads the jpg first, then the md that names it', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'photo', text: '', photoUse: 'show' }, 'SlBH');
  const up = fakeUpload();
  await flush(store, up, SETTINGS);
  assert.deepEqual(up.calls.map((c) => c.path), ['inbox/2026-11-24-180509-photo.jpg', 'inbox/2026-11-24-180509-photo.md']);
  assert.equal(up.calls[0].contentB64, 'SlBH');
  assert.match(decode(up.calls[1].contentB64), /image: "2026-11-24-180509-photo\.jpg"\nphoto_use: show/);
});

test('when the jpg succeeds but the md fails, the retry uploads only the md', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'photo', text: 'x' }, 'SlBH');
  await flush(store, fakeUpload({ 'inbox/2026-11-24-180509-photo.md': [{ ok: false, kind: 'other', status: 500 }] }), SETTINGS);
  assert.equal((await store.all())[0].jpgDone, true);
  const up2 = fakeUpload();
  assert.deepEqual(await flush(store, up2, SETTINGS), { sent: 1, left: 0, authError: false });
  assert.deepEqual(up2.calls.map((c) => c.path), ['inbox/2026-11-24-180509-photo.md']);
});

test('if the jpg was renamed to -2, the md follows the new name', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'photo', text: '' }, 'SlBH');
  const up = fakeUpload({
    'inbox/2026-11-24-180509-photo.jpg': [{ ok: true, path: 'inbox/2026-11-24-180509-photo-2.jpg' }],
  });
  await flush(store, up, SETTINGS);
  assert.equal(up.calls[1].path, 'inbox/2026-11-24-180509-photo-2.md');
  assert.match(decode(up.calls[1].contentB64), /image: "2026-11-24-180509-photo-2\.jpg"/);
});

test('an auth error stops the flush before the next item', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T1, source: 'text', text: 'a' });
  await enqueue(store, { date: T2, source: 'text', text: 'b' });
  const up = fakeUpload({ 'inbox/2026-11-24-180509-text.md': [{ ok: false, kind: 'auth', status: 401 }] });
  assert.deepEqual(await flush(store, up, SETTINGS), { sent: 0, left: 2, authError: true });
  assert.equal(up.calls.length, 1);
});

test('items are sent oldest first', async () => {
  const store = memoryStore();
  await enqueue(store, { date: T2, source: 'text', text: 'second' });
  await enqueue(store, { date: T1, source: 'text', text: 'first' });
  const up = fakeUpload();
  await flush(store, up, SETTINGS);
  assert.deepEqual(up.calls.map((c) => c.path), ['inbox/2026-11-24-180509-text.md', 'inbox/2026-11-24-180600-text.md']);
});
