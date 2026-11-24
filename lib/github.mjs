// Upload one file to a GitHub repo via the "Create or update file contents" endpoint.
// Docs: https://docs.github.com/en/rest/repos/contents (checked 2026-11-24 via Context7).
// Results never contain the token.

const API = 'https://api.github.com';
const MAX_SUFFIX = 3;

export function commitMessage(stem) {
  return `ingesture: capture ${stem}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function putFile(fetchFn, { owner, repo, branch, token, path, contentB64, message }) {
  let res;
  try {
    res = await fetchFn(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, content: contentB64, branch }),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (res.ok) return { ok: true, path };
  const { status } = res;
  // 404: a fine-grained token without access to the repo sees it as "not found".
  if (status === 401 || status === 403 || status === 404) return { ok: false, kind: 'auth', status };
  if (status === 422) return { ok: false, kind: 'conflict', status };
  return { ok: false, kind: 'other', status };
}

function withSuffix(path, n) {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
}

// Git's id for file content: sha1("blob <length>\0" + bytes), hex.
export async function gitBlobSha(contentB64) {
  const bin = atob(contentB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function existingSha(fetchFn, { owner, repo, branch, token, path }) {
  try {
    const res = await fetchFn(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } },
    );
    return res.ok ? (await res.json()).sha ?? null : null;
  } catch {
    return null;
  }
}

// "Already exists" (422) usually means our own earlier upload landed but the reply was lost.
// If the file there is byte-identical, that is success; otherwise try -2, -3.
export async function putUnique(fetchFn, args) {
  let path = args.path;
  let result = await putFile(fetchFn, args);
  for (let n = 2; result.kind === 'conflict'; n++) {
    if ((await existingSha(fetchFn, { ...args, path })) === (await gitBlobSha(args.contentB64))) {
      return { ok: true, path };
    }
    if (n > MAX_SUFFIX) break;
    path = withSuffix(args.path, n);
    result = await putFile(fetchFn, { ...args, path });
  }
  return result;
}
