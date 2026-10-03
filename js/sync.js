/* Cellar Book — Dropbox connection and sync.
   Uses Dropbox's PKCE "copy the code" flow, so no server or redirect page is needed.
   Files live in the app's own Dropbox folder (Apps/<your app name>/):
     /cellar.json                 all wines + palate profile
     /backups/cellar-YYYY-MM-DD.json   one copy per day
     /photos/<id>.jpg             label photos */
'use strict';

const DBX = {
  connected: () => !!(settings.dbx && settings.dbx.refresh_token),

  async beginAuth() {
    if (!settings.dbxAppKey) throw new Error('Add your Dropbox app key first.');
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(48)), b => ('0' + b.toString(16)).slice(-2)).join('').slice(0, 64);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem('cellarbook.pkce', verifier); } catch (e) {}
    const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
      client_id: settings.dbxAppKey, response_type: 'code', code_challenge: challenge,
      code_challenge_method: 'S256', token_access_type: 'offline',
    });
    return url;
  },

  async finishAuth(code) {
    let verifier = '';
    try { verifier = localStorage.getItem('cellarbook.pkce') || ''; } catch (e) {}
    if (!verifier) throw new Error('Start the connection again, then paste the new code.');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ code: code.trim(), grant_type: 'authorization_code', code_verifier: verifier, client_id: settings.dbxAppKey }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(j.error_description || 'Dropbox didn’t accept that code. Start again and paste the new code.');
    settings.dbx = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 14400) * 1000 - 60000, account: j.account_id || '' };
    saveSettings();
    try { localStorage.removeItem('cellarbook.pkce'); } catch (e) {}
  },

  disconnect() { settings.dbx = null; saveSettings(); },

  async token() {
    const d = settings.dbx;
    if (!d) throw new Error('Dropbox isn’t connected.');
    if (d.access_token && d.expires_at > Date.now()) return d.access_token;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refresh_token, client_id: settings.dbxAppKey }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { const e = new Error('Dropbox sign-in expired. Reconnect in Settings.'); e.code = 'auth'; throw e; }
    d.access_token = j.access_token; d.expires_at = Date.now() + (j.expires_in || 14400) * 1000 - 60000; saveSettings();
    return d.access_token;
  },

  /* Dropbox requires non-ASCII characters in this header to be escaped. */
  arg(obj) { return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)); },

  async download(path) {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST', headers: { Authorization: 'Bearer ' + await this.token(), 'Dropbox-API-Arg': this.arg({ path }) },
    });
    if (r.status === 409) return null; // not found
    if (r.status === 401) { settings.dbx.expires_at = 0; throw Object.assign(new Error('Dropbox sign-in expired.'), { code: 'auth' }); }
    if (!r.ok) throw new Error('Dropbox download failed (' + r.status + ')');
    return r.blob();
  },

  async upload(path, body) {
    // Send raw bytes: some Safari versions upload a Blob body as an empty file.
    const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new TextEncoder().encode(String(body));
    if (!bytes.length) throw new Error('Refused to upload an empty file.');
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': this.arg({ path, mode: 'overwrite', mute: true }) },
      body: bytes,
    });
    if (r.status === 401) { settings.dbx.expires_at = 0; throw Object.assign(new Error('Dropbox sign-in expired.'), { code: 'auth' }); }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(/missing_scope|scope/.test(t) ? 'Dropbox app needs the files.content.write permission (see setup guide), then reconnect.' : 'Dropbox upload failed (' + r.status + ')');
    }
    const meta = await r.json();
    if (typeof meta.size === 'number' && meta.size !== bytes.length) throw new Error('Dropbox saved an incomplete file. Try Sync now again.');
    return meta;
  },
};

/* ---------- Merge two copies of the data (this device + Dropbox) ---------- */
function mergeData(local, remote) {
  const out = { wines: {}, deleted: {}, profile: null, updated_at: nowIso() };
  const L = local || {}, R = remote || {};
  const delL = L.deleted || {}, delR = R.deleted || {};
  for (const [id, t] of Object.entries({ ...delL, ...delR })) out.deleted[id] = [delL[id], delR[id]].filter(Boolean).sort().pop();
  const ids = new Set([...Object.keys(L.wines || {}), ...Object.keys(R.wines || {})]);
  for (const id of ids) {
    const a = (L.wines || {})[id], b = (R.wines || {})[id];
    let w = a && b ? (String(a.updated_at || '') >= String(b.updated_at || '') ? a : b) : (a || b);
    const del = out.deleted[id];
    if (del && (!w || String(del) >= String(w.updated_at || ''))) continue;
    if (del && w) delete out.deleted[id];
    out.wines[id] = w;
  }
  const pa = L.profile, pb = R.profile;
  out.profile = pa && pb ? (String(pa.updated_at || '') >= String(pb.updated_at || '') ? pa : pb) : (pa || pb || null);
  // keep tombstones for 1 year
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString();
  for (const [id, t] of Object.entries(out.deleted)) if (t < cutoff) delete out.deleted[id];
  return out;
}
const fingerprint = d => JSON.stringify([d.wines, d.deleted, d.profile]);

/* ---------- Sync loop ---------- */
const SY = { busy: false, again: false, timer: null, error: null };
function scheduleSync(delay = 3000) {
  if (!DBX.connected()) { renderSyncChip(); return; }
  S.dirty = true; renderSyncChip();
  clearTimeout(SY.timer); SY.timer = setTimeout(() => syncNow(), delay);
}

async function syncNow(opts = {}) {
  if (!DBX.connected()) { renderSyncChip(); return; }
  if (SY.busy) { SY.again = true; return; }
  if (!navigator.onLine) { SY.error = 'Offline'; renderSyncChip(); return; }
  SY.busy = true; SY.error = null; renderSyncChip();
  try {
    const blob = await DBX.download('/cellar.json');
    let remote = null;
    if (blob) {
      const text = await blob.text();
      if (text.trim()) {
        try { remote = JSON.parse(text); } catch (e) { throw new Error('cellar.json in Dropbox is unreadable; not overwriting it.'); }
      }
    }
    const before = fingerprint(S.data);
    const merged = remote ? mergeData(S.data, remote) : S.data;
    const localChanged = fingerprint(merged) !== before;
    const remoteStale = !remote || fingerprint(merged) !== fingerprint(remote);
    if (localChanged) { S.data = merged; rebuildIndex(); persist(); renderAll(); }
    if (remoteStale) {
      const payload = { app: 'cellar-book', version: 1, ...S.data, synced_at: nowIso() };
      await DBX.upload('/cellar.json', JSON.stringify(payload));
    }
    if (settings.lastBackup !== today() && Object.keys(S.data.wines).length) {
      const payload = { app: 'cellar-book', version: 1, ...S.data, backup_of: today() };
      await DBX.upload(`/backups/cellar-${today()}.json`, JSON.stringify(payload, null, 1));
      settings.lastBackup = today();
    }
    await uploadPendingPhotos();
    S.dirty = false;
    settings.lastSync = nowIso(); saveSettings();
  } catch (e) {
    SY.error = e.code === 'auth' ? 'Reconnect Dropbox' : (e.message || 'Sync failed');
  } finally {
    SY.busy = false; renderSyncChip();
    if (SY.again) { SY.again = false; setTimeout(() => syncNow(), 500); }
  }
}

async function uploadPendingPhotos() {
  const keys = await IDB.keys('photos');
  for (const id of keys) {
    const rec = await IDB.get('photos', id);
    if (!rec || rec.uploaded || !rec.blob) continue;
    await DBX.upload(`/photos/${id}.jpg`, rec.blob);
    rec.uploaded = true; await IDB.put('photos', id, rec);
  }
}
async function fetchPhotoFromDropbox(id) {
  if (!DBX.connected() || !navigator.onLine) return null;
  return DBX.download(`/photos/${id}.jpg`);
}

function renderSyncChip() {
  const chip = $('#syncChip'), txt = $('#syncText');
  if (!chip) return;
  chip.className = 'sync-chip';
  if (!DBX.connected()) { chip.classList.add('off'); txt.textContent = 'This device only'; return; }
  if (SY.busy) { chip.classList.add('busy'); txt.textContent = 'Syncing…'; return; }
  if (SY.error) { chip.classList.add('err'); txt.textContent = SY.error; return; }
  if (S.dirty) { chip.classList.add('busy'); txt.textContent = 'Saving…'; return; }
  chip.classList.add('ok');
  txt.innerHTML = settings.lastSync ? `Synced<span class="lbl-long"> ${esc(timeAgo(settings.lastSync))}</span>` : 'Synced';
}
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return fmtDate(iso.slice(0, 10));
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('online', () => syncNow());
setInterval(renderSyncChip, 60000);
