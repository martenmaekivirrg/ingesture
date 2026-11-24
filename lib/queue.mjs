// Offline-safe queue: every capture is stored first, then uploaded.
// Nothing leaves the queue until GitHub confirms the file exists.

import { makeStem, buildMarkdown, utf8ToBase64 } from './capture.mjs';
import { commitMessage } from './github.mjs';

// Item: { id, stem, md (text), jpgB64?, jpgDone, createdAt }

export function memoryStore() {
  const items = new Map();
  return {
    async add(item) { items.set(item.id, structuredClone(item)); },
    async all() { return [...items.values()].map((i) => structuredClone(i)).sort(byAge); },
    async update(item) { items.set(item.id, structuredClone(item)); },
    async remove(id) { items.delete(id); },
  };
}

export function idbStore(dbName = 'ingesture') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', mode);
      const req = fn(tx.objectStore('queue'));
      tx.oncomplete = () => { db.close(); resolve(req?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };
  return {
    add: (item) => run('readwrite', (s) => s.put(item)),
    update: (item) => run('readwrite', (s) => s.put(item)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    all: async () => ((await run('readonly', (s) => s.getAll())) ?? []).sort(byAge),
  };
}

function byAge(a, b) {
  return a.createdAt - b.createdAt;
}

export async function enqueue(store, capture, jpgB64) {
  const stem = makeStem(capture.date, capture.source);
  const md = buildMarkdown({ ...capture, image: jpgB64 ? `${stem}.jpg` : capture.image });
  const item = {
    id: `${stem}-${Math.random().toString(36).slice(2, 8)}`,
    stem,
    md,
    jpgB64: jpgB64 ?? null,
    jpgDone: !jpgB64,
    createdAt: capture.date.getTime(),
  };
  await store.add(item);
  return item;
}

const fileStem = (path, ext) => path.split('/').pop().slice(0, -ext.length);

export async function flush(store, uploadFn, settings) {
  const { folder = 'inbox', ...repo } = settings;
  let sent = 0;
  for (const item of await store.all()) {
    if (!item.jpgDone) {
      const r = await uploadFn({
        ...repo, path: `${folder}/${item.stem}.jpg`, contentB64: item.jpgB64, message: commitMessage(item.stem),
      });
      if (!r.ok) {
        if (r.kind === 'auth') return { sent, left: (await store.all()).length, authError: true };
        continue;
      }
      const finalStem = fileStem(r.path, '.jpg');
      if (finalStem !== item.stem) {
        item.md = item.md.replace(`image: "${item.stem}.jpg"`, `image: "${finalStem}.jpg"`);
        item.stem = finalStem;
      }
      item.jpgDone = true;
      item.jpgB64 = null;
      await store.update(item);
    }
    const r = await uploadFn({
      ...repo, path: `${folder}/${item.stem}.md`, contentB64: utf8ToBase64(item.md), message: commitMessage(item.stem),
    });
    if (r.ok) {
      await store.remove(item.id);
      sent++;
    } else if (r.kind === 'auth') {
      return { sent, left: (await store.all()).length, authError: true };
    }
  }
  return { sent, left: (await store.all()).length, authError: false };
}
