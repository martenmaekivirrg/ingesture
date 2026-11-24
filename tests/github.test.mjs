import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putFile, putUnique, commitMessage, gitBlobSha } from '../lib/github.mjs';

const ARGS = {
  owner: 'martenmaekivirrg', repo: 'm6nsa-vault', branch: 'main',
  token: 'github_pat_SECRET123', path: 'inbox/2026-11-24-180509-voice.md',
  contentB64: 'SGk=', message: 'ingesture: capture 2026-11-24-180509-voice',
};

// Each response is a status number, { status, body }, or an Error to throw.
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    const { status, body = {} } = typeof r === 'number' ? { status: r } : r;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const puts = (f) => f.calls.filter((c) => c.method === 'PUT');

test('putFile sends PUT to the contents endpoint with GitHub headers and body', async () => {
  const f = fakeFetch(201);
  await putFile(f, ARGS);
  const { url, init, body } = f.calls[0];
  assert.equal(url, 'https://api.github.com/repos/martenmaekivirrg/m6nsa-vault/contents/inbox/2026-11-24-180509-voice.md');
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers.Authorization, 'Bearer github_pat_SECRET123');
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(body, { message: ARGS.message, content: 'SGk=', branch: 'main' });
});

test('putFile returns ok with the path on 201', async () => {
  assert.deepEqual(await putFile(fakeFetch(201), ARGS), { ok: true, path: ARGS.path });
});

for (const status of [401, 403, 404]) {
  test(`putFile maps ${status} to an auth error`, async () => {
    assert.deepEqual(await putFile(fakeFetch(status), ARGS), { ok: false, kind: 'auth', status });
  });
}

test('putFile maps a thrown fetch (offline) to a network error', async () => {
  assert.deepEqual(await putFile(fakeFetch(new TypeError('Failed to fetch')), ARGS), { ok: false, kind: 'network' });
});

test('putFile maps 422 (file already exists) to a conflict', async () => {
  assert.deepEqual(await putFile(fakeFetch(422), ARGS), { ok: false, kind: 'conflict', status: 422 });
});

test('putFile maps 409 and 500 to other (stays queued, retried later)', async () => {
  assert.deepEqual(await putFile(fakeFetch(409), ARGS), { ok: false, kind: 'other', status: 409 });
  assert.deepEqual(await putFile(fakeFetch(500), ARGS), { ok: false, kind: 'other', status: 500 });
});

test('putFile encodes special characters in the path', async () => {
  const f = fakeFetch(201);
  await putFile(f, { ...ARGS, path: 'inbox/a b#õ.md' });
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/martenmaekivirrg/m6nsa-vault/contents/inbox/a%20b%23%C3%B5.md');
});

test('gitBlobSha matches git hash-object', async () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(await gitBlobSha(Buffer.from('hello\n').toString('base64')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('putUnique retries with -2 before the extension when a different file has the name', async () => {
  const f = fakeFetch(422, { status: 200, body: { sha: 'someone-elses-file' } }, 201);
  const result = await putUnique(f, ARGS);
  assert.equal(puts(f)[1].url.endsWith('/contents/inbox/2026-11-24-180509-voice-2.md'), true);
  assert.deepEqual(result, { ok: true, path: 'inbox/2026-11-24-180509-voice-2.md' });
});

test('putUnique treats "already exists" as success when the file there is identical (lost reply)', async () => {
  const sha = await gitBlobSha(ARGS.contentB64);
  const f = fakeFetch(422, { status: 200, body: { sha } });
  const result = await putUnique(f, ARGS);
  assert.deepEqual(result, { ok: true, path: ARGS.path });
  assert.equal(puts(f).length, 1);
  const get = f.calls.find((c) => c.method === 'GET');
  assert.equal(get.url, 'https://api.github.com/repos/martenmaekivirrg/m6nsa-vault/contents/inbox/2026-11-24-180509-voice.md?ref=main');
  assert.equal(get.init.headers.Authorization, 'Bearer github_pat_SECRET123');
});

test('putUnique gives up after -3 and reports the conflict', async () => {
  const f = fakeFetch(422, 404, 422, 404, 422, 404);
  const result = await putUnique(f, ARGS);
  assert.equal(puts(f).length, 3);
  assert.equal(result.kind, 'conflict');
});

test('putUnique passes non-conflict errors straight through', async () => {
  const f = fakeFetch(401);
  assert.equal((await putUnique(f, ARGS)).kind, 'auth');
  assert.equal(f.calls.length, 1);
});

test('the token never appears in a result', async () => {
  for (const r of [401, 422, 500, new TypeError('x')]) {
    const out = JSON.stringify(await putFile(fakeFetch(r), ARGS));
    assert.equal(out.includes('SECRET123'), false);
  }
});

test('commitMessage names the capture stem', () => {
  assert.equal(commitMessage('2026-11-24-180509-voice'), 'ingesture: capture 2026-11-24-180509-voice');
});
