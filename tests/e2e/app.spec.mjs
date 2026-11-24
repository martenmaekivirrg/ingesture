import { test, expect } from '@playwright/test';

const SETTINGS = { owner: 'martenmaekivirrg', repo: 'm6nsa-vault', branch: 'main', token: 'test-token' };
const CONTENTS = 'https://api.github.com/repos/martenmaekivirrg/m6nsa-vault/contents/inbox/';

async function withToken(page) {
  await page.addInitScript((s) => localStorage.setItem('ingesture.settings', JSON.stringify(s)), SETTINGS);
}

async function noFonts(context) {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}

// Records every PUT to GitHub and answers with the given status.
async function mockGitHub(page, status = 201) {
  const puts = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    puts.push({ url: req.url(), auth: req.headers().authorization, body, text: Buffer.from(body.content || '', 'base64').toString('utf8') });
    await route.fulfill({ status, contentType: 'application/json', body: '{}' });
  });
  return puts;
}

async function queuedItems(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('ingesture', 1);
    req.onsuccess = () => {
      const all = req.result.transaction('queue').objectStore('queue').getAll();
      all.onsuccess = () => resolve(all.result);
    };
  }));
}

test.beforeEach(async ({ context }) => { await noFonts(context); });

test('sending text PUTs one inbox file with the capture format', async ({ page }) => {
  await withToken(page);
  const puts = await mockGitHub(page, 201);
  await page.goto('/');
  await page.fill('#text', 'I picture myself as someone who trains daily.');
  await page.fill('#hint', 'for Psycho-Cybernetics');
  await page.click('#send');
  await expect(page.locator('#status')).toHaveText('✓ in inbox');
  expect(puts).toHaveLength(1);
  expect(puts[0].url).toMatch(new RegExp(`^${CONTENTS}\\d{4}-\\d{2}-\\d{2}-\\d{6}-text\\.md$`));
  expect(puts[0].auth).toBe('Bearer test-token');
  expect(puts[0].body.branch).toBe('main');
  expect(puts[0].text).toContain('source: text\nhint: "for Psycho-Cybernetics"\n---\n\nI picture myself as someone who trains daily.\n');
  await expect(page.locator('#text')).toHaveValue('');
  await expect(page.locator('#queued')).toBeHidden();
});

test('send is disabled until there is text or a photo', async ({ page }) => {
  await withToken(page);
  await mockGitHub(page);
  await page.goto('/');
  await expect(page.locator('#send')).toBeDisabled();
  await page.fill('#text', '   ');
  await expect(page.locator('#send')).toBeDisabled();
  await page.fill('#text', 'x');
  await expect(page.locator('#send')).toBeEnabled();
});

test('offline capture is queued and sent after reconnecting', async ({ page, context }) => {
  await withToken(page);
  const puts = await mockGitHub(page, 201);
  await page.goto('/');
  await context.setOffline(true);
  await page.route('https://api.github.com/**', (r) => r.abort('internetdisconnected'));
  await page.fill('#text', 'Thought on the tram');
  await page.click('#send');
  await expect(page.locator('#queued')).toHaveText('queued (1)');
  await expect(page.locator('#status')).toHaveText('Saved on this phone. It will send when you are online.');
  await page.unroute('https://api.github.com/**');
  const after = await mockGitHub(page, 201);
  await context.setOffline(false); // fires 'online' → the app resends by itself
  await expect(page.locator('#status')).toHaveText('✓ in inbox');
  await expect(page.locator('#queued')).toBeHidden();
  expect(puts).toHaveLength(0);
  expect(after).toHaveLength(1);
  expect(after[0].text).toContain('Thought on the tram');
});

test('a rejected token keeps the capture and opens Settings', async ({ page }) => {
  await withToken(page);
  await mockGitHub(page, 401);
  await page.goto('/');
  await page.fill('#text', 'Keep me');
  await page.click('#send');
  await expect(page.locator('#status')).toHaveText('Token rejected – open Settings');
  await expect(page.locator('#settings')).toHaveAttribute('open', '');
  await expect(page.locator('#queued')).toHaveText('queued (1)');
});

test('a photo is sent as jpg first, then the md that names it', async ({ page }) => {
  await withToken(page);
  const puts = await mockGitHub(page, 201);
  await page.goto('/');
  // 2400x1200 PNG made in the page, so the resize path runs for real.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#2447D8'; g.fillRect(0, 0, 2400, 1200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles('#photo', { name: 'slide.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.getByRole('radio', { name: 'Summarize' }).check();
  await page.click('#send');
  await expect(page.locator('#status')).toHaveText('✓ in inbox');
  expect(puts.map((p) => p.url.split('/').pop())).toEqual([
    expect.stringMatching(/-photo\.jpg$/), expect.stringMatching(/-photo\.md$/),
  ]);
  const jpg = Buffer.from(puts[0].body.content, 'base64');
  expect(jpg.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // JPEG magic number
  const stem = puts[0].url.split('/').pop().replace('.jpg', '');
  expect(puts[1].text).toContain(`source: photo\nimage: "${stem}.jpg"\nphoto_use: summarize\n`);
});

// A fake recognizer that behaves like Chrome on Android: each result repeats the
// whole sentence so far. Every instance is recorded on window.__recs.
async function fakeAndroidSpeech(page) {
  await page.addInitScript(() => {
    window.__recs = [];
    const Fake = class {
      constructor() { window.__recs.push(this); }
      start() { this.started = true; }
      stop() { setTimeout(() => this.onend?.(), 0); }
      say(...parts) {
        const results = parts.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
        this.onresult?.({ resultIndex: 0, results });
      }
    };
    window.SpeechRecognition = Fake; // Chromium also has a native one; replace both names
    window.webkitSpeechRecognition = Fake;
  });
}

test('dictation on Android-style results writes each word once', async ({ page }) => {
  await withToken(page);
  await fakeAndroidSpeech(page);
  await page.goto('/');
  await page.click('#mic');
  await page.evaluate(() => {
    const r = window.__recs.at(-1);
    r.say('sorry baby');
    r.say('sorry baby', 'sorry baby I am here');
    r.onend(); // Android ends the session on a short pause
    window.__recs.at(-1).say('and still talking');
  });
  await expect(page.locator('#text')).toHaveValue('sorry baby I am here and still talking');
  expect(await page.evaluate(() => window.__recs.length)).toBe(2);
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
});

test('words that arrive after Send do not refill the cleared text box', async ({ page }) => {
  await withToken(page);
  await mockGitHub(page, 201);
  await fakeAndroidSpeech(page);
  await page.goto('/');
  await page.click('#mic');
  await page.evaluate(() => {
    const r = window.__recs.at(-1);
    r.say('a finished thought');
    r.stop = () => {}; // like Android: the session has not ended yet when Send stops it
  });
  await page.click('#send');
  await expect(page.locator('#status')).toHaveText('✓ in inbox');
  await page.evaluate(() => window.__recs.at(-1).say('a finished thought', 'late tail'));
  await expect(page.locator('#text')).toHaveValue('');
});

test('the dictation language switch picks Estonian and remembers it', async ({ page }) => {
  await withToken(page);
  await fakeAndroidSpeech(page);
  await page.goto('/');
  await expect(page.getByRole('radio', { name: 'EN' })).toBeChecked();
  await page.getByRole('radio', { name: 'ET' }).check();
  await page.click('#mic');
  expect(await page.evaluate(() => window.__recs.at(-1).lang)).toBe('et-EE');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'ET' })).toBeChecked();
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('an Android share opens the app prefilled and keeps the url', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const finalUrl = await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('title', 'First Principles');
      fd.append('text', 'Worth reading https://fs.blog/first-principles/');
      fd.append('url', '');
      const res = await fetch('./share', { method: 'POST', body: fd });
      return res.url;
    });
    expect(finalUrl).toMatch(/\/\?shared=1$/);
    await page.goto('/?shared=1');
    await expect(page.locator('#text')).toHaveValue('First Principles\nWorth reading https://fs.blog/first-principles/');
    await page.locator('#close-settings').click(); // no token in this test
    await page.click('#send');
    await expect(page.locator('#queued')).toHaveText('queued (1)');
    const [item] = await queuedItems(page);
    expect(item.stem).toMatch(/-share$/);
    expect(item.md).toContain('source: share\nurl: "https://fs.blog/first-principles/"\n');
  });

  test('a newly published version of the app code reaches an installed phone', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // "Publish" a new app.js: the worker's own network request now gets the new file.
    await context.route('**/app.js', async (route) => {
      if (route.request().serviceWorker()) {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: '// version 2\n' });
      } else {
        await route.continue();
      }
    });
    const served = await page.evaluate(async () => (await fetch('app.js')).text());
    expect(served).toBe('// version 2\n');
  });

  test('the app shell loads offline once installed', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Ingesture');
    await expect(page.locator('#mic, #mic-note')).not.toHaveCount(0);
  });
});
