// The inbox file format shared with the vault's file-inbox skill.
// inbox/YYYY-MM-DD-HHmmss-<source>.md, times in Europe/Tallinn.

const TZ = 'Europe/Tallinn';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function tallinnParts(date) {
  const p = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) p[type] = value;
  return p;
}

export function makeStem(date, source) {
  const p = tallinnParts(date);
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}${p.second}-${source}`;
}

export function tallinnIso(date) {
  const p = tallinnParts(date);
  const wallClockAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

// JSON strings are valid YAML double-quoted scalars, so JSON.stringify escapes safely.
export function buildMarkdown({ date, source, text, url, hint, image, photoUse }) {
  const lines = ['---', `captured: ${tallinnIso(date)}`, `source: ${source}`];
  if (url) lines.push(`url: ${JSON.stringify(url)}`);
  if (hint) lines.push(`hint: ${JSON.stringify(hint)}`);
  if (image) lines.push(`image: ${JSON.stringify(image)}`);
  if (photoUse) lines.push(`photo_use: ${photoUse}`);
  lines.push('---', '', text ?? '');
  return `${lines.join('\n')}\n`;
}

export function utf8ToBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
