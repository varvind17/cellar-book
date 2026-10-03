/* Cellar Book — Claude API (called straight from the browser with your own API key). */
'use strict';

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

async function claudeCall({ system, messages, tools, max_tokens = 1500, model, signal }) {
  if (!settings.apiKey) throw { code: 'no_key', message: 'Add your Claude API key in Settings.' };
  const body = { model: model || settings.model || MODELS[0][0], max_tokens, messages };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;
  let res;
  try {
    res = await fetch(CLAUDE_URL, {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json', 'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw { code: 'cancelled' };
    throw { code: 'network', message: 'Couldn’t reach Claude. Check your connection.' };
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (j && j.error && j.error.message) || res.statusText;
    const code = res.status === 401 ? 'bad_key' : res.status === 429 ? 'rate_limited' : res.status === 529 || res.status >= 500 ? 'overloaded' : res.status === 400 && /credit|billing/i.test(msg) ? 'billing' : 'api_error';
    throw { code, status: res.status, message: msg };
  }
  return j;
}

/* Runs a request that may use Claude's web search, continuing if the turn pauses. */
async function claudeWithSearch(params, useSearch) {
  const tools = useSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] : [];
  let messages = params.messages.slice();
  let resp;
  try {
    for (let i = 0; i < 4; i++) {
      resp = await claudeCall({ ...params, messages, tools: [...tools, ...(params.tools || [])] });
      if (resp.stop_reason !== 'pause_turn') break;
      messages = [...messages, { role: 'assistant', content: resp.content }];
    }
  } catch (e) {
    if (useSearch && e.code === 'api_error' && /web_search|tool/i.test(e.message || '')) {
      return claudeWithSearch(params, false); // web search not enabled for this key: answer without it
    }
    throw e;
  }
  return resp;
}

const textOf = resp => (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
function sourcesOf(resp) {
  const out = new Map();
  for (const b of resp.content || []) for (const c of (b.citations || [])) if (c.url) out.set(c.url, c.title || c.url);
  return [...out].slice(0, 6).map(([url, title]) => ({ url, title }));
}
function parseJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const a = Math.min(...['{', '['].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (isFinite(a) && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  throw { code: 'bad_json', message: 'Claude’s answer came back garbled. Try again.' };
}
async function imageBlocks(blobs) {
  const out = [];
  for (const b of blobs || []) {
    const small = await shrinkImage(b);
    out.push({ type: 'image', source: { type: 'base64', media_type: small.type === 'image/png' ? 'image/png' : 'image/jpeg', data: await blobToBase64(small) } });
  }
  return out;
}
async function askJSON(prompt, { images, max_tokens = 1500, search = false, model, signal } = {}) {
  const content = [...await imageBlocks(images), { type: 'text', text: prompt }];
  const resp = await claudeWithSearch({ messages: [{ role: 'user', content }], max_tokens, model, signal }, search);
  const data = parseJSON(textOf(resp));
  return { data, sources: sourcesOf(resp) };
}
function claudeErr(e) {
  const c = e && e.code;
  if (c === 'no_key') return 'Add your Claude API key in Settings to use this.';
  if (c === 'bad_key') return 'Your Claude API key wasn’t accepted. Check it in Settings.';
  if (c === 'billing') return 'Your Claude API account needs credits. Add them at console.anthropic.com.';
  if (c === 'rate_limited') return 'Too many requests right now. Try again in a minute.';
  if (c === 'overloaded') return 'Claude is busy right now. Try again shortly.';
  if (c === 'network') return e.message;
  if (c === 'cancelled') return 'Stopped.';
  if (c === 'bad_json') return e.message;
  return (e && e.message) ? 'Claude error: ' + e.message : 'Something went wrong reaching Claude. Try again.';
}

/* ---------- Prompts ---------- */
const WINE_FIELDS = `"producer":"winery or house","name":"cuvée or wine name, not the producer","vintage":2019 or null,"color":"red|white|rose|sparkling|orange|dessert|fortified","grapes":["..."],"country":"","region":"e.g. Napa Valley, Burgundy, Mosel","appellation":"specific AOC/AVA/DOCG or null","origin_lat":approximate latitude of the appellation or region,"origin_lng":approximate longitude,"body":"light|medium|full","tasting_profile":"1-2 sentences on how it typically tastes","food_pairing":"short","drink_from":year or null,"drink_to":year or null,"price_usd":typical US retail number or null,"about":"2-3 sentence summary of the producer and this wine"`;

function labelPrompt({ image, text, gps }) {
  return `${image ? 'Identify the wine in this label photo. Read every word on the label carefully.' : `Identify this wine: "${text}".`} Use your wine knowledge to fill in typical details for it. If unsure about a field, use null rather than guessing wildly.${gps ? `\nThe photo was taken at latitude ${gps.lat}, longitude ${gps.lng}.` : ''}

Reply with only JSON:
{${WINE_FIELDS},"confidence":"high|medium|low"}`;
}

function listPrompt(text) {
  return `Find every distinct wine in ${text ? 'this text' : 'these photos (a wine list, receipt, shelf or cellar)'}. Read carefully; include the vintage and price when shown. Skip non-wine items.${text ? `\n\nText:\n${text.slice(0, 20000)}` : ''}

Reply with only JSON: {"wines":[{"producer":"","name":"cuvée or wine name, not the producer","vintage":2019 or null,"color":"red|white|rose|sparkling|orange|dessert|fortified","region":"","country":"","price":"as shown, or null","quantity":number of bottles if shown (e.g. on a receipt), else 1}]}`;
}

function enrichPrompt(wines) {
  return `For each wine below, fill in typical details from your wine knowledge. Use null when unsure.

${wines.map(w => `${w.id} | ${wineLabel(w)} | ${[w.appellation, w.region, w.country].filter(Boolean).join(', ')}`).join('\n')}

Reply with only JSON mapping each id to an object: {"<id>":{${WINE_FIELDS}}}`;
}

function storyPrompt(w) {
  return `Write the background story for this wine for a curious wine lover's personal cellar app: ${wineLabel(w)}${w.appellation || w.region ? ` (${[w.appellation, w.region, w.country].filter(Boolean).join(', ')})` : ''}.${w.grapes && w.grapes.length ? ` Grapes: ${grapesOf(w).join(', ')}.` : ''}
Be specific and factual. Prefer concrete names, dates, places and numbers over generalities. If you aren't sure of a detail about a small producer, say what is known about the region instead of inventing.

Reply with only JSON:
{"region_history":"2-4 sentences on the history of the region/appellation and how it became known for wine",
"producer":"2-4 sentences on the winemaker/estate: who they are, founding, philosophy, notable wines",
"climate":"1-3 sentences on the climate and weather that shape this wine (e.g. continental, maritime, diurnal swings, rivers, altitude)",
"soils":"1-3 sentences on the soils and terrain (e.g. granite, limestone, slate, volcanic, slopes)",
"unique":"2-3 sentences on what is unique or interesting about this producer, vineyard or region — a story, tradition, technique or fun fact",
"in_the_glass":"1-2 sentences on what to expect from this specific wine and vintage"}`;
}

function applyInfo(w, out) {
  const str = v => (v == null ? '' : String(v).trim());
  const map = {
    producer: str(out.producer), name: str(out.name), vintage: parseInt(out.vintage) || null,
    color: CMAP[out.color] ? out.color : null, grapes: Array.isArray(out.grapes) ? out.grapes.map(String).filter(Boolean) : [],
    country: str(out.country), region: str(out.region), appellation: str(out.appellation),
    body: ['light', 'medium', 'full'].includes(out.body) ? out.body : null, tasting_profile: str(out.tasting_profile),
    food_pairing: str(out.food_pairing), about: str(out.about), drink_from: parseInt(out.drink_from) || null,
    drink_to: parseInt(out.drink_to) || null, price_usd: Number(out.price_usd) || null,
  };
  for (const [k, v] of Object.entries(map)) if (v !== null && v !== '' && !(Array.isArray(v) && !v.length)) w[k] = v;
  if (isFinite(parseFloat(out.origin_lat)) && isFinite(parseFloat(out.origin_lng)) && out.origin_lat !== null) w.origin = { lat: +parseFloat(out.origin_lat).toFixed(3), lng: +parseFloat(out.origin_lng).toFixed(3) };
  return w;
}
/* Fill only empty fields (used for background enrichment so edits are never overwritten). */
function fillEmpty(w, out) {
  const filled = applyInfo({}, out);
  for (const [k, v] of Object.entries(filled)) {
    const cur = w[k];
    if (cur == null || cur === '' || (Array.isArray(cur) && !cur.length)) w[k] = v;
  }
  return w;
}
