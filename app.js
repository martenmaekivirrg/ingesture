import { idbStore, enqueue, flush } from './lib/queue.mjs';
import { putUnique } from './lib/github.mjs';
import { resizeToJpegB64 } from './lib/image.mjs';
import { coalesce } from './lib/sender.mjs';
import { createDictation } from './lib/dictation.mjs';

const SETTINGS_KEY = 'ingesture.settings';
const DEFAULTS = { owner: 'martenmaekivirrg', repo: 'm6nsa-vault', branch: 'main', token: '' };

const $ = (id) => document.getElementById(id);
const el = {
  text: $('text'), hint: $('hint'), mic: $('mic'), micNote: $('mic-note'), photo: $('photo'),
  photoPanel: $('photo-panel'), photoPreview: $('photo-preview'), removePhoto: $('remove-photo'),
  send: $('send'), status: $('status'), queued: $('queued'),
  settings: $('settings'), settingsForm: $('settings-form'), openSettings: $('open-settings'), closeSettings: $('close-settings'),
  owner: $('owner'), repo: $('repo'), branch: $('branch'), token: $('token'),
};

const store = idbStore();
const state = { photo: null, usedMic: false, fromShare: false, url: '' };

// ---------- settings ----------

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode: keep in memory only */ }
}

let settings = loadSettings();

function openSettings() {
  el.owner.value = settings.owner;
  el.repo.value = settings.repo;
  el.branch.value = settings.branch;
  el.token.value = settings.token;
  if (!el.settings.open) el.settings.showModal();
}

el.openSettings.addEventListener('click', openSettings);
el.closeSettings.addEventListener('click', () => el.settings.close());
el.settingsForm.addEventListener('submit', () => {
  settings = {
    owner: el.owner.value.trim(), repo: el.repo.value.trim(),
    branch: el.branch.value.trim(), token: el.token.value.trim(),
  };
  saveSettings(settings);
  setStatus('Settings saved.');
  sendQueued();
});

// ---------- status ----------

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

async function showQueued() {
  const n = (await store.all()).length;
  el.queued.hidden = n === 0;
  el.queued.textContent = n ? `queued (${n})` : '';
}

function updateSendButton() {
  el.send.disabled = !el.text.value.trim() && !state.photo;
}

// ---------- sending ----------

async function flushOnce() {
  const pending = (await store.all()).length;
  if (!pending) { await showQueued(); return; }
  if (!settings.token) {
    setStatus('Saved on this phone. Add your GitHub token in Settings to send it.', 'error');
    await showQueued();
    openSettings();
    return;
  }
  try {
    const upload = (args) => putUnique((u, i) => fetch(u, i), args);
    const r = await flush(store, upload, { ...settings, folder: 'inbox' });
    if (r.authError) {
      setStatus('Token rejected – open Settings', 'error');
      openSettings();
    } else if (r.left > 0) {
      setStatus('Saved on this phone. It will send when you are online.');
    } else if (r.sent > 0) {
      setStatus('✓ in inbox', 'ok');
    }
  } finally {
    await showQueued();
  }
}

// A Send pressed during an upload is picked up by one extra round right after it.
const sendQueued = coalesce(flushOnce);

function sourceOf() {
  if (state.photo) return 'photo';
  if (state.fromShare) return 'share';
  if (state.usedMic) return 'voice';
  return 'text';
}

async function send() {
  stopDictation();
  dictation = null; // late words from that session must not refill the cleared form
  el.send.disabled = true;
  try {
    const photoUse = document.querySelector('input[name="photo-use"]:checked')?.value;
    const capture = {
      date: new Date(),
      source: sourceOf(),
      text: el.text.value.trim(),
      url: state.url || undefined,
      hint: el.hint.value.trim() || undefined,
      photoUse: state.photo ? photoUse : undefined,
    };
    const jpg = state.photo ? await resizeToJpegB64(state.photo) : undefined;
    await enqueue(store, capture, jpg);
    resetForm();
    setStatus('Sending…');
    await sendQueued();
  } catch (err) {
    setStatus(`Could not save the capture: ${err.message}`, 'error');
    updateSendButton();
  }
}

function resetForm() {
  el.text.value = '';
  el.hint.value = '';
  clearPhoto();
  state.usedMic = false;
  state.fromShare = false;
  state.url = '';
  updateSendButton();
}

el.send.addEventListener('click', send);
el.text.addEventListener('input', updateSendButton);

// ---------- photo ----------

function setPhoto(blob) {
  state.photo = blob;
  el.photoPreview.src = URL.createObjectURL(blob);
  el.photoPanel.hidden = false;
  updateSendButton();
}

function clearPhoto() {
  if (el.photoPreview.src) URL.revokeObjectURL(el.photoPreview.src);
  el.photoPreview.removeAttribute('src');
  state.photo = null;
  el.photo.value = '';
  for (const r of document.querySelectorAll('input[name="photo-use"]')) r.checked = false;
  el.photoPanel.hidden = true;
  updateSendButton();
}

el.photo.addEventListener('change', () => { if (el.photo.files[0]) setPhoto(el.photo.files[0]); });
el.removePhoto.addEventListener('click', clearPhoto);

// ---------- dictation ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG_KEY = 'ingesture.dictationLang';
let dictation = null;
let baseText = '';

function stopDictation() {
  dictation?.stop();
}

function loadLang() {
  try { return localStorage.getItem(LANG_KEY) || 'en-US'; } catch { return 'en-US'; }
}

for (const radio of document.querySelectorAll('input[name="dictation-lang"]')) {
  radio.checked = radio.value === loadLang();
  radio.addEventListener('change', () => {
    try { localStorage.setItem(LANG_KEY, radio.value); } catch { /* private mode: this session only */ }
  });
}

function chosenLang() {
  return document.querySelector('input[name="dictation-lang"]:checked')?.value || 'en-US';
}

if (!Recognition) {
  el.mic.hidden = true;
  el.micNote.hidden = false;
  $('dictation-lang').hidden = true;
} else {
  el.mic.addEventListener('click', () => {
    if (dictation?.active) { stopDictation(); return; }
    baseText = el.text.value.trim() ? `${el.text.value.trim()} ` : '';
    const d = createDictation({
      Recognition,
      lang: chosenLang(),
      silenceMs: 6000,
      onText: (spoken) => {
        if (dictation !== d) return; // detached by Send
        el.text.value = baseText + spoken;
        state.usedMic = true;
        updateSendButton();
      },
      onListening: (on) => {
        if (dictation && dictation !== d) return; // a newer dictation owns the button
        el.mic.setAttribute('aria-pressed', String(on));
        el.mic.setAttribute('aria-label', on ? 'Stop dictation' : 'Start dictation');
        if (on) setStatus('Listening… stops after 6 s of silence');
        else if (el.status.textContent.startsWith('Listening')) setStatus('');
      },
      onError: (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          setStatus('Microphone blocked. Allow it in the browser settings, or use the keyboard mic.', 'error');
        } else if (error === 'language-not-supported') {
          setStatus('This phone cannot dictate in that language. Try the keyboard mic.', 'error');
        } else {
          setStatus(`Dictation stopped: ${error}`, 'error');
        }
      },
    });
    dictation = d;
    d.start();
  });
}

// ---------- shared from another app (filled in by sw.js) ----------

async function takeShared() {
  if (new URLSearchParams(location.search).get('shared') !== '1') return;
  history.replaceState(null, '', location.pathname);
  const shared = await readSharedOnce();
  if (!shared) return;
  const parts = [shared.title, shared.text].filter((s) => s && s.trim() && s.trim() !== shared.url);
  el.text.value = parts.join('\n');
  state.url = shared.url || '';
  if (!state.url) {
    const found = (shared.text || '').match(/https?:\/\/\S+/);
    if (found) state.url = found[0];
  }
  state.fromShare = true;
  if (shared.image) setPhoto(shared.image);
  updateSendButton();
  setStatus('Shared item ready. Add a note if you like, then send.');
}

function readSharedOnce() {
  return new Promise((resolve) => {
    const req = indexedDB.open('ingesture', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { keyPath: 'id' });
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('shared', 'readwrite');
      const os = tx.objectStore('shared');
      const get = os.get('latest');
      get.onsuccess = () => { os.delete('latest'); };
      tx.oncomplete = () => { db.close(); resolve(get.result ?? null); };
      tx.onerror = () => { db.close(); resolve(null); };
    };
  });
}

// ---------- start ----------

window.addEventListener('online', sendQueued);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works online */ });
}

(async () => {
  await takeShared();
  updateSendButton();
  if (!settings.token && !el.settings.open) openSettings();
  else await sendQueued();
})();
