// Dictation on top of the Web Speech API (SpeechRecognition).
// Docs: Web Speech API spec (webaudio/web-speech-api), checked 2026-11-24 via Context7.
//
// Two browser behaviours this works around:
// 1. The spec says each final result holds only new words. Chrome on Android instead
//    repeats the whole sentence so far in each result ("a", "a b", "a b c"), so plain
//    concatenation doubled every word. mergeTranscripts() keeps the latest version.
// 2. Chrome on Android ends a session after a short pause even with continuous = true.
//    createDictation() restarts it and only stops after `silenceMs` without new words,
//    or when stop() is called.

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Joins result transcripts, replacing a piece that only repeats and extends the one before it. */
export function mergeTranscripts(parts) {
  const out = [];
  for (const part of parts) {
    const text = part.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (out.length && norm(text).startsWith(norm(out.at(-1)))) out[out.length - 1] = text;
    else out.push(text);
  }
  return out.join(' ');
}

const join = (a, b) => [a, b].filter(Boolean).join(' ');
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network']);

/**
 * @returns {{ start(): void, stop(): void, readonly active: boolean }}
 * onText(text) gets everything dictated since start(); onListening(bool) on start and end;
 * onError(code) for problems that end dictation.
 */
export function createDictation({
  Recognition, lang, silenceMs = 6000, onText, onListening, onError, timers = globalThis,
}) {
  let active = false;
  let committed = ''; // text from sessions that already ended
  let current = '';   // text of the running session
  let rec = null;
  let silenceTimer = null;

  function armSilence() {
    timers.clearTimeout(silenceTimer);
    silenceTimer = timers.setTimeout(() => stop(), silenceMs);
  }

  function finish() {
    timers.clearTimeout(silenceTimer);
    rec = null;
    onListening?.(false);
  }

  function startSession() {
    const r = new Recognition();
    rec = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      if (r !== rec) return;
      current = mergeTranscripts(Array.from(event.results, (res) => res[0].transcript));
      onText?.(join(committed, current));
      armSilence();
    };
    r.onerror = (event) => {
      if (r !== rec || !FATAL.has(event.error)) return;
      active = false;
      onError?.(event.error);
    };
    r.onend = () => {
      if (r !== rec) return;
      committed = join(committed, current);
      current = '';
      if (active) startSession();
      else finish();
    };
    r.start();
  }

  function start() {
    if (active) return;
    active = true;
    committed = '';
    current = '';
    onListening?.(true);
    armSilence();
    startSession();
  }

  function stop() {
    if (!active) return;
    active = false;
    timers.clearTimeout(silenceTimer);
    rec?.stop();
  }

  return { start, stop, get active() { return active; } };
}
