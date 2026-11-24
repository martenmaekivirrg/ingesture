import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTranscripts, createDictation } from '../lib/dictation.mjs';

// ---------- mergeTranscripts ----------

test('Android repeats the whole sentence in every result: keep it once (real capture 2026-11-24)', () => {
  const parts = [
    ...Array(9).fill("sorry baby I'm"),
    "sorry baby I'm about to have a car or something",
    "sorry baby I'm about to have a car or something stupid",
    "sorry baby I'm about to have a car or something stupid",
  ];
  assert.equal(mergeTranscripts(parts), "sorry baby I'm about to have a car or something stupid");
});

test('separate sentences (desktop Chrome, as the spec says) are joined with one space', () => {
  assert.equal(mergeTranscripts(['first thought', ' and then a second one']), 'first thought and then a second one');
});

test('a growing sentence after a finished one replaces only its own earlier version', () => {
  assert.equal(mergeTranscripts(['one idea', 'next', 'next part', 'next part done']), 'one idea next part done');
});

test('repeat detection ignores case and spacing differences', () => {
  assert.equal(mergeTranscripts(['Hello there', 'hello  there friend']), 'hello there friend');
});

test('nothing said gives empty text', () => {
  assert.equal(mergeTranscripts([]), '');
  assert.equal(mergeTranscripts(['', '  ']), '');
});

// ---------- createDictation ----------

class FakeRecognition {
  static instances = [];
  constructor() { this.started = false; this.stopped = false; FakeRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.stopped = true; queueMicrotask(() => this.onend?.()); }
  say(...transcripts) { // one result event; every transcript is a final result
    const results = transcripts.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
    this.onresult?.({ resultIndex: 0, results });
  }
  fail(error) { this.onerror?.({ error }); this.onend?.(); }
  end() { this.onend?.(); } // the browser ends the session on its own (Android: short pause)
}

function fakeClock() {
  let now = 0; let next = 1; const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
      }
    },
  };
}

function setup(lang = 'en-US') {
  FakeRecognition.instances = [];
  const clock = fakeClock();
  const seen = { texts: [], listening: [], errors: [] };
  const d = createDictation({
    Recognition: FakeRecognition, lang, silenceMs: 6000, timers: clock,
    onText: (t) => seen.texts.push(t), onListening: (on) => seen.listening.push(on), onError: (e) => seen.errors.push(e),
  });
  const current = () => FakeRecognition.instances.at(-1);
  return { d, clock, seen, current };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('start uses the chosen language and continuous recognition', () => {
  const { d, current, seen } = setup('et-EE');
  d.start();
  assert.equal(current().lang, 'et-EE');
  assert.equal(current().continuous, true);
  assert.equal(current().interimResults, true);
  assert.equal(current().started, true);
  assert.deepEqual(seen.listening, [true]);
});

test('a short pause that ends the browser session does not end dictation: it restarts and keeps the text', () => {
  const { d, current, seen } = setup();
  d.start();
  current().say('first part');
  current().end(); // Android stops after ~2 s of silence
  assert.equal(FakeRecognition.instances.length, 2, 'a new session started');
  assert.equal(current().started, true);
  current().say('second part');
  assert.equal(seen.texts.at(-1), 'first part second part');
  assert.equal(d.active, true);
  assert.deepEqual(seen.listening, [true]);
});

test('6 seconds without new words ends dictation', async () => {
  const { d, clock, current, seen } = setup();
  d.start();
  current().say('a thought');
  clock.advance(5900);
  assert.equal(d.active, true);
  clock.advance(100);
  await tick();
  assert.equal(current().stopped, true);
  assert.equal(d.active, false);
  assert.deepEqual(seen.listening, [true, false]);
  assert.equal(FakeRecognition.instances.length, 1, 'no restart after the silence stop');
});

test('new words reset the 6 second silence timer, also across restarts', () => {
  const { d, clock, current } = setup();
  d.start();
  clock.advance(5000);
  current().say('still talking');
  clock.advance(3000);
  current().end();
  clock.advance(2900);
  assert.equal(d.active, true, '5.9 s since the last words');
  current().say('more');
  clock.advance(5999);
  assert.equal(d.active, true);
});

test('pressing stop ends dictation at once and keeps the text', async () => {
  const { d, current, seen } = setup();
  d.start();
  current().say('done now');
  d.stop();
  await tick();
  assert.equal(d.active, false);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(seen.texts.at(-1), 'done now');
  assert.deepEqual(seen.listening, [true, false]);
});

test('a blocked microphone stops dictation and reports it instead of restarting', () => {
  const { d, current, seen } = setup();
  d.start();
  current().fail('not-allowed');
  assert.equal(d.active, false);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.deepEqual(seen.errors, ['not-allowed']);
  assert.deepEqual(seen.listening, [true, false]);
});

test('"no-speech" is just silence: keep listening until the 6 seconds are up', () => {
  const { d, current, seen } = setup();
  d.start();
  current().fail('no-speech');
  assert.equal(d.active, true);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.deepEqual(seen.errors, []);
});

test('Android-style cumulative results inside a session are merged', () => {
  const { d, current, seen } = setup();
  d.start();
  current().say('one');
  current().say('one', 'one two');
  current().say('one', 'one two', 'one two three');
  assert.equal(seen.texts.at(-1), 'one two three');
});
