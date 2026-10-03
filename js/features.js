/* Cellar Book — features: scan a list, background enrichment + stories, Pick for me, Ask chat, Map. */
'use strict';

/* ---------- Scan a list ---------- */
const SC = { imgs: [], found: [], dest: 'cellar', busy: false };

function setupScanner() {
  $('#scanPhotos').addEventListener('change', e => { SC.imgs.push(...e.target.files); e.target.value = ''; renderScanThumbs(); });
  $('#scanThumbs').addEventListener('click', e => { const b = e.target.closest('[data-rmscan]'); if (b) { SC.imgs.splice(+b.dataset.rmscan, 1); renderScanThumbs(); } });
  $('#scanGo').addEventListener('click', runScan);
  $('#scanDest').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    SC.dest = b.dataset.v;
    $$('#scanDest [data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderScanResults();
  });
  $('#scanResults').addEventListener('input', e => {
    const row = e.target.closest('[data-si]'); if (!row) return;
    const it = SC.found[+row.dataset.si]; const f = e.target.dataset.f;
    if (f === 'qty') it.quantity = Math.max(0, parseInt(e.target.value) || 0);
    else if (f === 'vintage') it.vintage = parseInt(e.target.value) || null;
    else if (f) it[f] = e.target.value;
  });
  $('#scanResults').addEventListener('change', e => {
    const row = e.target.closest('[data-si]'); if (!row || e.target.type !== 'checkbox') return;
    SC.found[+row.dataset.si].on = e.target.checked; row.classList.toggle('off', !e.target.checked); updateScanButton();
  });
  $('#scanAdd').addEventListener('click', addScanned);
}
function openScanner(dest = 'cellar') {
  SC.imgs = []; SC.found = []; SC.dest = dest;
  ['#detail', '#editor', '#settings'].forEach(s => { $(s).hidden = true; }); S.ed = null;
  $('#scanText').value = ''; $('#scanStatus').textContent = ''; $('#scanStatus').className = 'status';
  $$('#scanDest [data-v]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === dest));
  renderScanThumbs(); renderScanResults();
  openSheet('#scanner');
  if (!hasClaude()) { $('#scanStatus').className = 'status err'; $('#scanStatus').innerHTML = 'Add your Claude API key in <a href="#" data-opensettings>Settings</a> to scan lists.'; }
}
function renderScanThumbs() {
  $('#scanThumbs').innerHTML = SC.imgs.map((f, i) => `<figure><img alt="Photo ${i + 1}" src="${URL.createObjectURL(f)}"><button type="button" data-rmscan="${i}" aria-label="Remove photo">×</button></figure>`).join('');
}
async function runScan() {
  if (SC.busy) return;
  const st = $('#scanStatus'); st.className = 'status';
  const text = $('#scanText').value.trim();
  if (!SC.imgs.length && !text) { st.className = 'status err'; st.textContent = 'Add a photo or paste some text first.'; return; }
  if (!hasClaude()) { st.className = 'status err'; st.innerHTML = 'Add your Claude API key in <a href="#" data-opensettings>Settings</a> first.'; return; }
  SC.busy = true; $('#scanGo').disabled = true; st.textContent = 'Claude is reading the list… this can take up to a minute for long lists.';
  try {
    const { data } = await askJSON(listPrompt(SC.imgs.length ? '' : text) + (SC.imgs.length && text ? `\n\nAlso include wines in this text:\n${text.slice(0, 8000)}` : ''), { images: SC.imgs, max_tokens: 6000 });
    const wines = Array.isArray(data) ? data : (data && data.wines) || [];
    SC.found = wines.filter(x => x && (x.producer || x.name)).map(x => ({
      producer: String(x.producer || '').trim(), name: String(x.name || '').trim(), vintage: parseInt(x.vintage) || null,
      color: CMAP[x.color] ? x.color : null, region: String(x.region || ''), country: String(x.country || ''),
      price: x.price ? String(x.price) : '', quantity: Math.max(1, parseInt(x.quantity) || 1), on: true,
    }));
    st.textContent = SC.found.length ? `Found ${SC.found.length} ${SC.found.length === 1 ? 'wine' : 'wines'}. Untick any you don’t want and fix names if needed.` : 'No wines found. Try a sharper photo or paste the text.';
    renderScanResults();
  } catch (e) { st.className = 'status err'; st.textContent = claudeErr(e); }
  finally { SC.busy = false; $('#scanGo').disabled = false; }
}
function renderScanResults() {
  const el = $('#scanResults');
  $('#scanFoot').hidden = !SC.found.length;
  if (!SC.found.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec" style="padding-top:0"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Wines found</h3><span class="hint">${SC.dest === 'cellar' ? 'Bottles' : ''}</span></div>` + SC.found.map((it, i) => {
    const m = findMatch(it);
    return `<div class="scan-row${it.on ? '' : ' off'}" data-si="${i}">
      <input type="checkbox" ${it.on ? 'checked' : ''} aria-label="Include this wine">
      <span class="glass" style="--g:${colorVar(it.color)}"></span>
      <div class="scan-fields">
        <input data-f="producer" value="${esc(it.producer)}" placeholder="Producer" aria-label="Producer">
        <input data-f="vintage" value="${esc(it.vintage || '')}" placeholder="NV" inputmode="numeric" aria-label="Vintage">
        <input class="wide" data-f="name" value="${esc(it.name)}" placeholder="Wine" aria-label="Wine name">
        <span class="scan-meta">${esc([it.region, it.country, it.price].filter(Boolean).join(' · '))}${m ? ` · <b>already in your book</b>` : ''}</span>
      </div>
      ${SC.dest === 'cellar' ? `<input class="qty-in" data-f="qty" type="number" min="0" value="${it.quantity}" aria-label="Bottles">` : '<span></span>'}
    </div>`;
  }).join('') + '</div>';
  updateScanButton();
}
function updateScanButton() {
  const n = SC.found.filter(x => x.on).length;
  $('#scanAdd').textContent = `Add ${n} ${n === 1 ? 'wine' : 'wines'}`;
  $('#scanAdd').disabled = !n;
}
function addScanned() {
  const pick = SC.found.filter(x => x.on && (x.producer || x.name));
  let added = 0, updated = 0;
  for (const it of pick) {
    const f = { producer: it.producer, name: it.name, vintage: it.vintage };
    const m = findMatch(f);
    const id = m ? m.id : newId(f);
    const w = m ? clone(S.data.wines[id]) : blankWine({ ...f, color: it.color, region: it.region, country: it.country, source: 'list', needs_details: true, needs_story: settings.autoStory });
    if (SC.dest === 'cellar') { w.bottles = (Number(w.bottles) || 0) + (it.quantity || 1); w.wishlist = false; const p = parseFloat(String(it.price).replace(/[^0-9.]/g, '')); if (p && !w.paid) w.paid = p; }
    if (SC.dest === 'want') w.wishlist = true;
    if (SC.dest === 'tasted') { w.tastings = [...(w.tastings || []), { date: today(), rating: null }]; recalc(w); w.wishlist = false; }
    S.data.wines[id] = { ...w, updated_at: nowIso() };
    if (S.data.deleted) delete S.data.deleted[id];
    m ? updated++ : added++;
  }
  changed(); kickQueue();
  toast(`${added} added${updated ? `, ${updated} updated` : ''}. Claude is filling in details.`);
  closeSheets();
  setTab(SC.dest === 'cellar' ? 'cellar' : 'journal');
}

/* ---------- Background work: fill in details, write stories ---------- */
const Q = { running: false };
S.storyBusy = new Set();
function renderWork(text) { const c = $('#workChip'); if (!c) return; c.hidden = !text; c.textContent = text || ''; }
async function kickQueue() {
  if (Q.running || !hasClaude() || !navigator.onLine) return;
  Q.running = true;
  try {
    for (let guard = 0; guard < 200; guard++) {
      const needDetails = [...S.wines.values()].filter(w => w.needs_details);
      if (needDetails.length) {
        const batch = needDetails.slice(0, 6);
        renderWork(`Claude is filling in ${needDetails.length} ${needDetails.length === 1 ? 'wine' : 'wines'}…`);
        try {
          const { data } = await askJSON(enrichPrompt(batch), { max_tokens: 4000 });
          for (const w of batch) {
            const cur = S.data.wines[w.id]; if (!cur) continue;
            const out = data && data[w.id];
            const upd = clone(cur);
            if (out) fillEmpty(upd, out);
            delete upd.needs_details;
            S.data.wines[w.id] = { ...upd, updated_at: nowIso() };
          }
          changed();
        } catch (e) { renderWork(''); if (['bad_key', 'billing', 'no_key'].includes(e.code)) toast(claudeErr(e)); break; }
        continue;
      }
      const needStory = [...S.wines.values()].filter(w => w.needs_story && !S.storyBusy.has(w.id));
      if (needStory.length) {
        renderWork(`Claude is writing ${needStory.length} ${needStory.length === 1 ? 'story' : 'stories'}…`);
        const ok = await writeStory(needStory[0].id, false);
        if (!ok) break;
        continue;
      }
      break;
    }
  } finally { Q.running = false; renderWork(''); }
}
async function writeStory(id, manual) {
  const w = S.wines.get(id); if (!w) return false;
  if (!hasClaude()) { if (manual) openSettings(); return false; }
  S.storyBusy.add(id); if (S.detailId === id) renderDetail();
  try {
    const { data, sources } = await askJSON(storyPrompt(w), { max_tokens: 2500, search: settings.webSearch });
    if (!data || !data.region_history) throw { code: 'bad_json', message: 'The story came back garbled. Try again.' };
    const cur = S.data.wines[id];
    if (cur) {
      const story = {};
      for (const k of ['region_history', 'producer', 'climate', 'soils', 'unique', 'in_the_glass']) if (data[k]) story[k] = String(data[k]);
      story.sources = sources; story.written_at = nowIso();
      const upd = { ...cur, story }; delete upd.needs_story;
      S.data.wines[id] = { ...upd, updated_at: nowIso() };
      changed();
    }
    return true;
  } catch (e) {
    if (manual) toast(claudeErr(e));
    const cur = S.data.wines[id];
    if (cur && cur.needs_story && !manual) { delete cur.needs_story; changed(); }
    return !['bad_key', 'billing', 'no_key', 'rate_limited'].includes(e.code);
  } finally { S.storyBusy.delete(id); if (S.detailId === id) renderDetail(); }
}
window.addEventListener('online', () => kickQueue());

/* ---------- Pick for me ---------- */
function setupPick() {
  $('#pickWhere').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    S.pickWhere = b.dataset.v;
    $$('#pickWhere [data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#pickText').placeholder = S.pickWhere === 'store' ? 'Paste wines from the shop’s website…' : 'Paste the wine list from the restaurant’s website…';
  });
  $('#pickPhotos').addEventListener('change', e => { S.pickImgs.push(...e.target.files); e.target.value = ''; renderPickThumbs(); });
  $('#pickThumbs').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { S.pickImgs.splice(+b.dataset.rm, 1); renderPickThumbs(); } });
  $('#pickForm').addEventListener('submit', e => { e.preventDefault(); runPick(); });
  $('#pickStop').addEventListener('click', () => S.pickCtl?.abort());
}
function renderPickThumbs() {
  $('#pickThumbs').innerHTML = S.pickImgs.map((f, i) => `<figure><img alt="List photo ${i + 1}" src="${URL.createObjectURL(f)}"><button type="button" data-rm="${i}" aria-label="Remove photo">×</button></figure>`).join('');
}
function renderPickIntro() {
  const rated = [...S.wines.values()].filter(w => RMAP[w.rating]).length;
  $('#pickResults').innerHTML = `<div class="empty" style="text-align:left;padding:8px 0">
    <h3>At a wine shop or restaurant?</h3>
    <p>Add photos of the list or shelf, or paste it from their website. Claude compares it with ${rated ? `your <b>${rated}</b> rated wines` : 'your ratings'} and picks what you’re most likely to enjoy, with a reason for each.</p>
    ${hasClaude() ? '' : '<p>Add your Claude API key in <a href="#" data-opensettings>Settings</a> to use this.</p>'}
  </div>`;
}
async function runPick() {
  const st = $('#pickStatus'); st.className = 'status';
  if (!hasClaude()) { st.className = 'status err'; st.innerHTML = 'Add your Claude API key in <a href="#" data-opensettings>Settings</a> first.'; return; }
  const text = $('#pickText').value.trim();
  if (!text && !S.pickImgs.length) { st.className = 'status err'; st.textContent = 'Add a photo or paste the list first.'; return; }
  const ctx = $('#pickCtx').value.trim();
  const p = S.data.profile;
  const prompt =
`You are Varun's personal sommelier. He is at a ${S.pickWhere === 'store' ? 'wine shop' : 'restaurant'}.${ctx ? ` Context: ${ctx}.` : ''}
The wine list is in the attached photos and/or the pasted text below. Pick the wines FROM THAT LIST he is most likely to enjoy, based on his history. Only recommend wines that actually appear on the list. Prefer wines similar in style to what he loves; avoid styles he dislikes. Include one adventurous pick when it makes sense.${S.pickWhere === 'restaurant' ? ' Flag good value (list price under ~2.5× typical retail).' : ''}

${p?.summary ? `His taste profile: ${p.summary}\n` : ''}His ratings (LOVE > LIKE > MEH > DISLIKE):
${historyDigest(250) || '(no ratings yet: go with broadly well-made, good-value choices and say so)'}

${text ? `The list (pasted):\n${text.slice(0, 20000)}\n` : ''}
Reply with only JSON:
{"picks":[{"wine":"producer, wine and vintage as listed","price":"as listed, or null","color":"red|white|rose|sparkling|orange|dessert|fortified","match":"strong|good|adventurous","why":"1-2 sentences tied to his history","reminds_of":"a wine from his history it resembles, or null"}],"skip":[{"wine":"...","why":"short"}],"note":"one short sentence of overall advice"}
Give 3-6 picks, best first, and 0-3 to skip.`;
  S.pickCtl = new AbortController();
  $('#pickGo').disabled = true; $('#pickStop').hidden = false;
  S.pickResult = null;
  $('#pickResults').innerHTML = `<p class="thinking">Reading the list and comparing it with your palate…</p>`;
  try {
    const { data: out } = await askJSON(prompt, { images: S.pickImgs, max_tokens: 2500, signal: S.pickCtl.signal });
    if (!out || !Array.isArray(out.picks)) throw { code: 'bad_json', message: 'Claude’s answer came back garbled. Try again.' };
    S.pickResult = out; renderPickResult(); st.textContent = '';
  } catch (e) { st.className = 'status err'; st.textContent = claudeErr(e); S.pickResult = null; renderPickIntro(); }
  finally { $('#pickGo').disabled = false; $('#pickStop').hidden = true; }
}
function renderPickResult() {
  const r = S.pickResult; if (!r) return;
  const label = { strong: 'Strong match', good: 'Good match', adventurous: 'Adventurous' };
  $('#pickResults').innerHTML = `
    ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    ${r.picks.map((x, i) => `<div class="pick-card">
      <span class="glass" style="--g:${colorVar(x.color)};margin-top:4px"></span>
      <div style="min-width:0">
        <h4>${esc(x.wine)}</h4>
        <div class="meta"><span class="match ${esc(x.match || 'good')}">${esc(label[x.match] || 'Match')}</span>${x.price ? `<span class="num">${esc(x.price)}</span>` : ''}</div>
        <p>${esc(x.why)}</p>
        ${x.reminds_of ? `<p class="like">Reminds you of ${esc(x.reminds_of)}</p>` : ''}
        <div class="row" style="margin-top:6px"><button class="btn sm" type="button" data-want="${i}">Save to Want to try</button><button class="btn sm" type="button" data-pickbuy="${i}">I bought it</button></div>
      </div>
    </div>`).join('')}
    ${r.skip?.length ? `<div class="skip"><div class="lbl">Probably skip</div><ul>${r.skip.map(s => `<li><b>${esc(s.wine)}</b> — ${esc(s.why)}</li>`).join('')}</ul></div>` : ''}`;
}
function savePick(i, btn, mode) {
  const x = S.pickResult?.picks?.[i]; if (!x) return;
  const m = String(x.wine).match(/\b(19|20)\d{2}\b/);
  const vintage = m ? parseInt(m[0]) : null;
  const name = String(x.wine).replace(/\b(19|20)\d{2}\b/, '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
  const f = { producer: '', name, vintage };
  const ex = findMatch(f);
  const id = ex ? ex.id : newId(f);
  const w = ex ? clone(S.data.wines[id]) : blankWine({ name, vintage, color: CMAP[x.color] ? x.color : null, notes: x.why ? `Recommended: ${x.why}` : '', needs_details: true, needs_story: settings.autoStory });
  if (mode === 'want') w.wishlist = true; else { w.bottles = (Number(w.bottles) || 0) + 1; w.wishlist = false; const p = parseFloat(String(x.price || '').replace(/[^0-9.]/g, '')); if (p) w.paid = p; }
  putWine(id, w);
  btn.textContent = mode === 'want' ? 'Saved' : 'Added to cellar'; btn.disabled = true;
}

/* ---------- Ask (chat) ---------- */
const SUGGESTIONS = [
  'What should I open tonight from my cellar?',
  'Which wines have I loved the most, and what do they have in common?',
  'Tell me about the wine I’m drinking right now',
  'Which bottles should I drink soon?',
  'What kind of white wine do I usually like?',
];
S.chat = []; S.chatImgs = []; S.chatCtl = null; S.chatBusy = false;
try { const saved = JSON.parse(localStorage.getItem('cellarbook.chat') || '[]'); if (Array.isArray(saved)) S.chat = saved.slice(-40); } catch (e) {}
function saveChat() { try { localStorage.setItem('cellarbook.chat', JSON.stringify(S.chat.slice(-40).map(m => ({ role: m.role, content: m.content, photos: m.photos || 0, actions: m.actions || [] })))); } catch (e) {} }

function md(src) {
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of esc(src).split('\n')) {
    const l = raw.trimEnd(); let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close();
    if ((m = l.match(/^#{1,4}\s+(.*)/))) { out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  close(); return out.join('');
}
function msgHtml(m, i) {
  if (m.role === 'user') {
    const imgs = (m.imgUrls || []).map(u => `<img alt="Your photo" src="${u}">`).join('');
    const note = !m.imgUrls?.length && m.photos ? `<em>[${m.photos} photo${m.photos > 1 ? 's' : ''}]</em>\n` : '';
    return `<div class="msg user">${imgs}${note}${esc(m.content)}</div>`;
  }
  const body = m.content ? md(m.content) : `<p class="working">${esc(m.status || 'Thinking…')}</p>`;
  const acts = (m.actions || []).map((a, j) => `<span class="action-chip${a.undone ? ' undone' : ''}">${esc(a.label)}${a.undone ? '' : `<button type="button" data-undo="${i}:${j}">Undo</button>`}</span>`).join('');
  return `<div class="msg bot" data-mi="${i}">${body}${acts ? `<div class="actions">${acts}</div>` : ''}${m.error ? `<p class="err">${esc(m.error)}</p>` : ''}</div>`;
}
function renderChat() {
  const log = $('#chatLog');
  $('#chatAttach').hidden = !hasClaude();
  $('#chatNew').hidden = !S.chat.length || S.chatBusy;
  if (!S.chat.length) {
    log.innerHTML = !hasClaude() ? emptyState('Ask your cellar book', 'Add your Claude API key in <a href="#" data-opensettings>Settings</a> to chat about your wines.')
      : `<div><h3 class="p-h">Try asking</h3><div class="suggest">${SUGGESTIONS.map(s => `<button type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    return;
  }
  log.innerHTML = S.chat.map(msgHtml).join('');
}
function updateBubble(i) {
  const el = document.querySelector(`#chatLog [data-mi="${i}"]`);
  if (el) el.outerHTML = msgHtml(S.chat[i], i); else renderChat();
  const near = window.innerHeight + window.scrollY >= document.body.scrollHeight - 260;
  if (near) window.scrollTo({ top: document.body.scrollHeight });
}
function chatDigest(max = 400) {
  const all = [...S.wines.values()];
  const pri = w => (Number(w.bottles) > 0 ? 2 : 0) + (RMAP[w.rating] ? 1 : 0);
  all.sort((a, b) => pri(b) - pri(a) || String(b.last_tasted || '').localeCompare(String(a.last_tasted || '')));
  return all.slice(0, max).map(w => [w.id, w.rating || (w.wishlist ? 'want-to-try' : 'unrated'), wineLabel(w), CMAP[w.color] || '', grapesOf(w).join(', '), placeOf(w), `bottles:${Number(w.bottles) || 0}`, w.last_tasted ? `last:${w.last_tasted}` : ''].join(' | ')).join('\n')
    + (all.length > max ? `\n(+${all.length - max} more; use search_wines)` : '');
}
function chatSystem() {
  const p = S.data.profile;
  return `You are the sommelier inside Varun's Cellar Book app, chatting with him (often on his phone, glass in hand). Today is ${today()}.
- Answer questions about wines he has had, what's in his cellar, the wine he's drinking now, and wine in general.
- Ground anything about his history in his data below. Use search_wines and get_wine for tasting notes, stories and details. Never invent wines he hasn't logged; if something isn't in his book, say so.
- If he shares a label photo or names a wine he's drinking, identify it and tell him something useful (style, what to expect, how it compares with wines he's rated).
- Call log_wine only when he asks you to log or save something, or clearly reports a rating (Love, Like, Meh or Dislike), or says he bought bottles. Ratings are optional. Fill in the wine details you know (grapes, region, style, drinking window, typical price, origin_lat/origin_lng).
- Ratings scale: Love > Like > Meh > Dislike.
- Keep replies short and conversational. Light markdown only: short paragraphs, **bold**, bullet lists. No tables.

${p?.summary ? `His taste profile: ${p.summary}\n` : ''}His wines (${S.wines.size}) — id | rating | wine | style | grapes | region | bottles | last tasted:
${S.wines.size ? chatDigest() : '(none logged yet)'}`;
}
const CHAT_TOOLS = [
  { name: 'search_wines', description: 'Search his logged wines by text (producer, wine, grape, region, country, notes) with optional filters. Returns up to 30 matches with id, rating, bottles and last tasted date.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, rating: { type: 'string', enum: ['love', 'like', 'meh', 'dislike'] }, color: { type: 'string', enum: COLORS.map(c => c[0]) }, in_cellar: { type: 'boolean' }, wishlist: { type: 'boolean' } } } },
  { name: 'get_wine', description: 'Full record for one wine by id: details, story, every tasting with date, rating, place and notes, and cellar info.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'log_wine', description: 'Save a wine to his Cellar Book: a tasting (rating optional), bottles bought or opened (bottles_delta), or want-to-try. Matches an existing wine by producer + name + vintage. Returns what was saved.',
    input_schema: { type: 'object', properties: {
      producer: { type: 'string' }, name: { type: 'string', description: 'cuvée, not the producer' }, vintage: { type: 'integer' },
      color: { type: 'string', enum: COLORS.map(c => c[0]) }, grapes: { type: 'array', items: { type: 'string' } },
      region: { type: 'string' }, country: { type: 'string' }, appellation: { type: 'string' }, body: { type: 'string', enum: ['light', 'medium', 'full'] },
      tasting_profile: { type: 'string' }, food_pairing: { type: 'string' }, about: { type: 'string' },
      drink_from: { type: 'integer' }, drink_to: { type: 'integer' }, price_usd: { type: 'number' }, origin_lat: { type: 'number' }, origin_lng: { type: 'number' },
      tasted: { type: 'boolean', description: 'true if he drank/is drinking it' }, rating: { type: 'string', enum: ['love', 'like', 'meh', 'dislike'] },
      tasting_notes: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, where: { type: 'string' },
      bottles_delta: { type: 'integer', description: '+N bought, -1 opened from cellar' }, wishlist: { type: 'boolean' } }, required: ['producer'] } },
];
async function runChatTool(name, i, msgIdx) {
  const str = v => (v == null ? '' : String(v).trim());
  if (name === 'search_wines') {
    const q = norm(i.query);
    let list = [...S.wines.values()];
    if (q) list = list.filter(w => q.split(' ').every(t => norm([w.producer, w.name, w.vintage, grapesOf(w).join(' '), w.region, w.country, w.appellation, w.notes, ...(w.tastings || []).map(t => t.notes)].join(' ')).includes(t)));
    if (i.rating) list = list.filter(w => w.rating === i.rating);
    if (i.color) list = list.filter(w => w.color === i.color);
    if (i.in_cellar) list = list.filter(w => Number(w.bottles) > 0);
    if (i.wishlist) list = list.filter(w => w.wishlist);
    return list.slice(0, 30).map(w => ({ id: w.id, wine: wineLabel(w), rating: w.rating, color: w.color, grapes: grapesOf(w), region: placeOf(w), bottles: Number(w.bottles) || 0, last_tasted: w.last_tasted }));
  }
  if (name === 'get_wine') {
    const w = S.wines.get(str(i.id));
    if (!w) throw new Error('No wine with that id. Use search_wines first.');
    const { created_at, updated_at, label_photo, ...rest } = w;
    return rest;
  }
  if (name === 'log_wine') {
    const f = { producer: str(i.producer), name: str(i.name), vintage: parseInt(i.vintage) || null };
    if (!f.producer && !f.name) throw new Error('Need a producer or wine name.');
    const ex = findMatch(f);
    const prev = ex ? clone(S.data.wines[ex.id]) : null;
    const id = ex ? ex.id : newId(f);
    const w = ex ? clone(S.data.wines[id]) : blankWine({ ...f, source: 'claude', needs_story: settings.autoStory });
    fillEmpty(w, i);
    const parts = [];
    if (i.tasted || RMAP[i.rating]) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(str(i.date)) ? str(i.date) : today();
      const t = { date: d, rating: RMAP[i.rating] ? i.rating : null };
      if (str(i.tasting_notes)) t.notes = str(i.tasting_notes);
      if (str(i.where)) t.where = str(i.where);
      const g = S.chat[msgIdx] && S.chat[msgIdx].gps;
      if (g) { t.lat = g.lat; t.lng = g.lng; t.place = str(i.where) || g.place || ''; }
      else if (str(i.where)) { const est = await geocode(str(i.where)); if (est) { t.lat = est.lat; t.lng = est.lng; t.place = str(i.where); t.loc_est = true; } }
      w.tastings = [...(w.tastings || []), t]; w.wishlist = false; recalc(w);
      parts.push(t.rating ? RMAP[t.rating].label : 'tasted');
    }
    const delta = parseInt(i.bottles_delta) || 0;
    if (delta) { w.bottles = Math.max(0, (Number(w.bottles) || 0) + delta); if (delta > 0) w.wishlist = false; parts.push(`${delta > 0 ? '+' : ''}${delta} bottle${Math.abs(delta) === 1 ? '' : 's'}`); }
    if (i.wishlist === true && !parts.length) { w.wishlist = true; parts.push('Want to try'); }
    if (S.chat[msgIdx] && S.chat[msgIdx].photoBlob && !w.label_photo) { try { w.label_photo = await savePhoto(S.chat[msgIdx].photoBlob); } catch (e) {} }
    putWine(id, w);
    const label = `${ex ? 'Updated' : 'Logged'} ${wineLabel(w)}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    const m = S.chat[msgIdx];
    if (m) { (m.actions = m.actions || []).push({ id, prev, label, undone: false }); updateBubble(msgIdx); }
    return { saved: true, id, action: ex ? 'updated' : 'created', rating: w.rating, bottles: w.bottles, wishlist: !!w.wishlist };
  }
  throw new Error('Unknown tool');
}
function undoAction(mi, ai) {
  const a = S.chat[mi]?.actions?.[ai]; if (!a || a.undone) return;
  if (a.prev) putWine(a.id, a.prev); else deleteWine(a.id);
  a.undone = true; updateBubble(mi); saveChat(); toast('Undone');
}
function renderChatThumbs() {
  $('#chatThumbs').innerHTML = S.chatImgs.map((f, i) => `<figure><img alt="Photo ${i + 1}" src="${URL.createObjectURL(f)}"><button type="button" data-rmchat="${i}" aria-label="Remove photo">×</button></figure>`).join('');
}
function growInput() { const t = $('#chatInput'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 140) + 'px'; }
async function sendChat(textArg) {
  if (S.chatBusy) return;
  const input = $('#chatInput');
  const text = (textArg ?? input.value).trim();
  const imgs = S.chatImgs.slice();
  if (!text && !imgs.length) return;
  if (!hasClaude()) { openSettings(); return; }
  input.value = ''; growInput(); S.chatImgs = []; renderChatThumbs();
  S.chat.push({ role: 'user', content: text || 'What is this wine?', photos: imgs.length, imgUrls: imgs.map(f => URL.createObjectURL(f)) });
  const botIdx = S.chat.push({ role: 'assistant', content: '', status: 'Thinking…', actions: [] }) - 1;
  S.chatBusy = true; setSendMode(true); renderChat(); window.scrollTo({ top: document.body.scrollHeight });
  const bot = S.chat[botIdx];
  let locNote = '';
  if (imgs.length) {
    const meta = await readPhotoMeta(imgs[0]);
    bot.photoBlob = await shrinkImage(imgs[0]);
    let g = meta.gps;
    if (!g && settings.saveLocation) g = await currentPosition(6000);
    if (g) { bot.gps = { ...g }; bot.gps.place = await reverseGeocode(g.lat, g.lng); locNote = `\n(He is at ${bot.gps.place || `${g.lat}, ${g.lng}`}. If you log a tasting, that location is saved automatically.)`; }
  }
  const history = S.chat.slice(0, botIdx).slice(-16).filter(m => m.content && !m.error)
    .map(m => ({ role: m.role, content: m.role === 'user' && m.photos && !m.imgUrls ? `${m.content}\n(He attached ${m.photos} photo${m.photos > 1 ? 's' : ''} earlier.)` : m.content }));
  while (history.length && history[0].role !== 'user') history.shift();
  const last = history.pop();
  const lastContent = [...await imageBlocks(imgs), { type: 'text', text: last.content + locNote }];
  let messages = [...history, { role: 'user', content: lastContent }];
  S.chatCtl = new AbortController();
  try {
    let finalText = '';
    for (let round = 0; round < 6; round++) {
      const resp = await claudeCall({ system: chatSystem(), messages, tools: CHAT_TOOLS, max_tokens: 1500, signal: S.chatCtl.signal });
      const txt = textOf(resp);
      if (txt) { finalText = (finalText ? finalText + '\n\n' : '') + txt; bot.content = finalText; updateBubble(botIdx); }
      if (resp.stop_reason !== 'tool_use') break;
      const results = [];
      for (const b of resp.content.filter(c => c.type === 'tool_use')) {
        bot.status = b.name === 'log_wine' ? 'Saving to your cellar book…' : 'Looking through your wines…'; if (!bot.content) updateBubble(botIdx);
        try { results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await runChatTool(b.name, b.input || {}, botIdx)).slice(0, 30000) }); }
        catch (err) { results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Error: ' + (err.message || err), is_error: true }); }
      }
      messages = [...messages, { role: 'assistant', content: resp.content }, { role: 'user', content: results }];
    }
    if (!bot.content) bot.content = 'Done.';
  } catch (e) {
    if (e.code !== 'cancelled') bot.error = claudeErr(e); else if (!bot.content) bot.content = '_Stopped._';
  } finally {
    S.chatBusy = false; setSendMode(false); delete bot.status; delete bot.photoBlob;
    updateBubble(botIdx); $('#chatNew').hidden = false; saveChat();
  }
}
function setSendMode(busy) { const b = $('#chatSend'); b.textContent = busy ? 'Stop' : 'Send'; b.type = busy ? 'button' : 'submit'; }
function setupChat() {
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
  $('#chatSend').addEventListener('click', e => { if (S.chatBusy) { e.preventDefault(); S.chatCtl?.abort(); } });
  $('#chatInput').addEventListener('input', growInput);
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); sendChat(); } });
  $('#chatPhoto').addEventListener('change', e => { S.chatImgs.push(...e.target.files); e.target.value = ''; renderChatThumbs(); });
  $('#chatThumbs').addEventListener('click', e => { const b = e.target.closest('[data-rmchat]'); if (b) { S.chatImgs.splice(+b.dataset.rmchat, 1); renderChatThumbs(); } });
  $('#chatNew').addEventListener('click', () => { if (S.chatBusy) return; S.chat = []; saveChat(); renderChat(); });
}

/* ---------- Map (Leaflet + OpenStreetMap/CARTO tiles) ---------- */
const M = { map: null, layer: null, mode: 'origin', sel: null, pts: [], fitted: {}, tiles: null, dark: null };
function setupMap() {
  $('#mapMode').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    M.mode = b.dataset.v; M.sel = null;
    $$('#mapMode [data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderMap(); fitMap();
  });
}
function isDark() { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
function initMap() {
  if (M.map || !window.L) return;
  M.map = L.map('leafletMap', { zoomControl: true, worldCopyJump: true, attributionControl: true }).setView([30, 0], 2);
  setTiles();
  M.layer = L.layerGroup().addTo(M.map);
  M.map.on('click', () => { if (M.sel) { M.sel = null; drawDots(); renderMapDetail(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', setTiles);
}
function setTiles() {
  const dark = isDark(); if (M.tiles && M.dark === dark) return;
  if (M.tiles) M.map.removeLayer(M.tiles);
  M.dark = dark;
  M.tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
    subdomains: 'abcd', maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(M.map);
}
function bestRating(list) { let best = null; for (const r of list) if (RMAP[r] && (!best || RMAP[r].score > RMAP[best].score)) best = r; return best; }
function mapPoints() {
  const pts = new Map();
  const add = (key, lat, lng, item, nm) => {
    const p = pts.get(key) || { key, lat, lng, items: [], names: {} };
    p.items.push(item); p.names[nm] = (p.names[nm] || 0) + 1; pts.set(key, p);
  };
  for (const w of S.wines.values()) {
    if (M.mode === 'origin') {
      const o = w.origin; if (!o || !isFinite(o.lat) || !isFinite(o.lng)) continue;
      add(`${(+o.lat).toFixed(1)},${(+o.lng).toFixed(1)}`, +o.lat, +o.lng, { w }, w.appellation || w.region || w.country || 'Unknown region');
    } else for (const t of (w.tastings || [])) {
      if (t.lat == null || !isFinite(t.lat) || !isFinite(t.lng)) continue;
      add(`${(+t.lat).toFixed(3)},${(+t.lng).toFixed(3)}`, +t.lat, +t.lng, { w, t }, t.place || t.where || 'Unnamed spot');
    }
  }
  return [...pts.values()].map(p => ({ ...p, label: Object.entries(p.names).sort((a, b) => b[1] - a[1])[0][0], n: p.items.length, rating: bestRating(p.items.map(x => x.t ? x.t.rating : x.w.rating)), r: 6 + Math.sqrt(p.items.length) * 3 })).sort((a, b) => b.n - a.n);
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function drawDots() {
  if (!M.map) return;
  M.pts = mapPoints();
  M.layer.clearLayers();
  for (const p of M.pts.slice().reverse()) {
    const col = cssVar(p.rating ? `--${p.rating}` : '--muted');
    const mk = L.circleMarker([p.lat, p.lng], { radius: p.r, color: M.sel === p.key ? cssVar('--ink') : cssVar('--surface'), weight: M.sel === p.key ? 3 : 1.5, fillColor: col, fillOpacity: .85 });
    mk.bindTooltip(`${esc(p.label)} · ${p.n}`, { direction: 'top' });
    mk.on('click', e => { L.DomEvent.stopPropagation(e); M.sel = p.key; drawDots(); renderMapDetail(); });
    mk.addTo(M.layer);
  }
  const total = M.pts.reduce((a, p) => a + p.n, 0);
  $('#mapCount').textContent = M.mode === 'origin' ? `${total} ${total === 1 ? 'wine' : 'wines'} from ${M.pts.length} ${M.pts.length === 1 ? 'place' : 'places'}` : `${total} ${total === 1 ? 'tasting' : 'tastings'} in ${M.pts.length} ${M.pts.length === 1 ? 'place' : 'places'}`;
  const msg = $('#mapMsg'); msg.hidden = !!M.pts.length;
  msg.textContent = M.mode === 'origin' ? 'Wines appear here once they have a region.' : 'Tastings appear here when you log them with your location on.';
}
function fitMap() {
  if (!M.map) return;
  if (!M.pts.length) { M.map.setView([30, 0], 2); return; }
  const b = L.latLngBounds(M.pts.map(p => [p.lat, p.lng]));
  M.map.fitBounds(b.pad(0.25), { maxZoom: M.mode === 'drank' ? 14 : 7 });
}
function renderMapLegend() {
  $('#mapLegend').innerHTML = RATINGS.map(r => `<span><span class="dot" style="--c:var(--${r.key})"></span>${r.label}</span>`).join('') + `<span><span class="dot" style="--c:var(--muted)"></span>Not rated</span><span>${M.mode === 'origin' ? 'Bigger dot = more wines · color = your best rating there' : 'Bigger dot = more tastings'}</span>`;
}
function renderMapMissing() {
  const el = $('#mapMissing');
  if (M.mode !== 'origin') {
    const noLoc = [...S.wines.values()].reduce((a, w) => a + (w.tastings || []).filter(t => t.lat == null).length, 0);
    el.innerHTML = noLoc ? `<div class="missing"><span>${noLoc} ${noLoc === 1 ? 'tasting has' : 'tastings have'} no location (older imports, or location was off).</span></div>` : '';
    return;
  }
  const miss = [...S.wines.values()].filter(w => !(w.origin && isFinite(w.origin.lat)));
  el.innerHTML = miss.length ? `<div class="missing"><span>${miss.length} ${miss.length === 1 ? 'wine isn’t' : 'wines aren’t'} on the map yet.</span>${hasClaude() ? `<button class="btn sm" type="button" id="placeBtn">Place ${miss.length === 1 ? 'it' : 'them'} with Claude</button>` : ''}</div><p class="status" id="placeStatus"></p>` : '';
}
async function placeMissing() {
  const btn = $('#placeBtn'), st = $('#placeStatus');
  const miss = [...S.wines.values()].filter(w => !(w.origin && isFinite(w.origin.lat))).slice(0, 150);
  btn.disabled = true; st.className = 'status'; st.textContent = 'Finding where these wines are made…';
  try {
    const { data: out } = await askJSON(`For each wine below, give the approximate latitude and longitude of where it is made: the center of its appellation or region, or the producer's location if more precise. Use null if you can't tell.
Reply with only JSON mapping each id to [lat, lng].

${miss.map(w => `${w.id} | ${wineLabel(w)} | ${[w.appellation, w.region, w.country].filter(Boolean).join(', ')}`).join('\n')}`, { max_tokens: 4000 });
    let n = 0;
    for (const w of miss) {
      const v = out && out[w.id];
      if (!Array.isArray(v) || v[0] == null || !isFinite(parseFloat(v[0])) || !isFinite(parseFloat(v[1]))) continue;
      S.data.wines[w.id] = { ...S.data.wines[w.id], origin: { lat: +parseFloat(v[0]).toFixed(3), lng: +parseFloat(v[1]).toFixed(3) }, updated_at: nowIso() }; n++;
    }
    changed(); toast(`Placed ${n} ${n === 1 ? 'wine' : 'wines'} on the map`); fitMap();
  } catch (e) { st.className = 'status err'; st.textContent = claudeErr(e); btn.disabled = false; }
}
function renderMapDetail() {
  const el = $('#mapDetail');
  const p = M.sel && M.pts.find(x => x.key === M.sel);
  if (!p) {
    const top = M.pts.slice(0, 8);
    el.innerHTML = top.length ? `<div class="map-place"><h3 class="p-h">${M.mode === 'origin' ? 'Top regions' : 'Your spots'}</h3>${top.map(x => `<div class="agg-row" style="cursor:pointer" data-mapsel="${esc(x.key)}"><span class="nm">${esc(x.label)}</span>${mixBar(x.items.reduce((c, it) => { const r = it.t ? it.t.rating : it.w.rating; if (r) c[r] = (c[r] || 0) + 1; return c; }, {}), x.n)}<span class="n">${x.n}</span></div>`).join('')}<p class="hint">Tap a dot or a row to see the wines.</p></div>` : '';
    return;
  }
  const rows = M.mode === 'origin'
    ? p.items.map(({ w }) => wineRow(w, `${w.rating ? rateChip(w.rating) : (w.wishlist ? '<span class="rate r-want">Want to try</span>' : '')}${Number(w.bottles) ? `<span class="w-date">${w.bottles} in cellar</span>` : ''}`))
    : p.items.sort((a, b) => String(b.t.date || '').localeCompare(String(a.t.date || ''))).map(({ w, t }) => wineRow(w, `${rateChip(t.rating)}<span class="w-date">${esc(fmtDate(t.date))}</span>`));
  el.innerHTML = `<div class="map-place"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><h3>${esc(p.label)}</h3><button class="btn sm ghost" type="button" data-mapclear>Show all</button></div>
    <p class="hint" style="margin:0 0 8px">${p.n} ${M.mode === 'origin' ? (p.n === 1 ? 'wine' : 'wines') : (p.n === 1 ? 'tasting' : 'tastings')}</p><div class="list">${rows.join('')}</div></div>`;
}
function renderMap() {
  renderMapLegend(); renderMapMissing();
  if (!window.L) { $('#mapMsg').hidden = false; $('#mapMsg').textContent = 'The map couldn’t load.'; return; }
  initMap();
  setTimeout(() => M.map && M.map.invalidateSize(), 50);
  drawDots(); renderMapDetail();
  if (!M.fitted[M.mode] && S.loaded) { M.fitted[M.mode] = true; setTimeout(fitMap, 80); }
}

/* ---------- Clicks for these features ---------- */
function onFeatureClick(e) {
  const t = e.target;
  const wt = t.closest('[data-want]'); if (wt) return savePick(+wt.dataset.want, wt, 'want');
  const pb = t.closest('[data-pickbuy]'); if (pb) return savePick(+pb.dataset.pickbuy, pb, 'buy');
  const sg = t.closest('[data-suggest]');
  if (sg) { const s = sg.dataset.suggest; if (/right now/.test(s)) { $('#chatInput').value = s; growInput(); $('#chatPhoto').click(); return; } return sendChat(s); }
  const un = t.closest('[data-undo]'); if (un) { const [mi, ai] = un.dataset.undo.split(':').map(Number); return undoAction(mi, ai); }
  if (t.closest('[data-zoom="fit"]')) return fitMap();
  const ms = t.closest('[data-mapsel]'); if (ms) { M.sel = ms.dataset.mapsel; drawDots(); renderMapDetail(); const p = M.pts.find(x => x.key === M.sel); if (p) M.map.setView([p.lat, p.lng], Math.max(M.map.getZoom(), M.mode === 'origin' ? 7 : 14)); $('#mapBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  if (t.closest('[data-mapclear]')) { M.sel = null; drawDots(); renderMapDetail(); return; }
  if (t.closest('#placeBtn')) return placeMissing();
}
