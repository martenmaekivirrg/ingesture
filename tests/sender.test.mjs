import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce } from '../lib/sender.mjs';

function gatedRun() {
  let calls = 0;
  const gates = [];
  const run = () => { calls++; return new Promise((resolve) => gates.push(resolve)); };
  return { run, calls: () => calls, open: (value) => gates.shift()(value) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('one trigger runs once', async () => {
  const g = gatedRun();
  const send = coalesce(g.run);
  const p = send();
  g.open('done');
  assert.equal(await p, 'done');
  assert.equal(g.calls(), 1);
});

test('triggers during a run cause exactly one more run afterwards', async () => {
  const g = gatedRun();
  const send = coalesce(g.run);
  const first = send();
  const second = send(); // a new capture while the first upload runs
  const third = send();
  assert.equal(g.calls(), 1);
  g.open('first pass');
  await tick();
  assert.equal(g.calls(), 2);
  g.open('second pass');
  assert.deepEqual(await Promise.all([first, second, third]), ['second pass', 'second pass', 'second pass']);
});

test('a trigger after a run has finished starts a fresh run', async () => {
  const g = gatedRun();
  const send = coalesce(g.run);
  const a = send();
  g.open(1);
  await a;
  const b = send();
  g.open(2);
  assert.equal(await b, 2);
  assert.equal(g.calls(), 2);
});

test('a failing run is reported and does not block the next trigger', async () => {
  let n = 0;
  const send = coalesce(async () => { n++; if (n === 1) throw new Error('boom'); return 'ok'; });
  await assert.rejects(send(), /boom/);
  assert.equal(await send(), 'ok');
});
