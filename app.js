/* Life HQ phone app: Today (dashboard) and Health log in one page.
   Each Home Screen icon opens on its own tab and is paired separately (iPhone keeps
   each icon's storage apart). Talks only to the Ru - Inbox Receiver script. */
'use strict';
const APP_VERSION = 'v11 · 28 Oct';
const ROOT = document.documentElement;
const START = ROOT.dataset.start === 'today' ? 'today' : 'log';
const BASE = ROOT.dataset.base || './';
const UNDO_MS = 5000;
const GPT_URL = 'https://chatgpt.com/g/g-p-6abfbfcab4cc8191bff95054e150f72c/project';
const LINKS = {
  hqSheet: 'https://docs.google.com/spreadsheets/d/1apxgN6nt1-eRLEs4FPoLxlz_jCRTNHENTv1BKb0A3Ss/edit',
  healthGpt: 'https://chatgpt.com/g/g-p-6aa91f74be24819194dbc4a27bbefa83/project',
  healthSheet: 'https://docs.google.com/spreadsheets/d/1QkafN7IUI48_fNUCXt7eW6dty-is6qXV-SKTliwmRLY/edit',
  moneyGpt: 'https://chatgpt.com/g/g-p-6acf8514eb3c8191911f0206654c6568/project',
  moneySheet: 'https://docs.google.com/spreadsheets/d/1BTDWxXeNIoe106swS5elL95POGdvddpM-4BMJGzoLko/edit',
  works: 'https://docs.google.com/spreadsheets/d/1y5eEXAtQMUYAlrEbTkOHcwdi0AqoSR7V6O9CbTYBBB4/edit',
  inventory: 'https://docs.google.com/spreadsheets/d/1Ol5M26V3L-Bt-d_MIPrL6o6es7f2o28l28lhtaRUsgU/edit'
};
const fileLinks = (pairs) => '<p class="file-links">' + pairs.map(([label, url]) => '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>').join('<span aria-hidden="true"> · </span>') + '</p>';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const LS = {
  get(k, d) { try { const v = localStorage.getItem('hl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hl.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('hl.' + k); } catch (e) {} }
};

/* ================= theme ================= */
const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function themePref() { try { return JSON.parse(localStorage.getItem('hq.theme') || '"auto"'); } catch (e) { return 'auto'; } }
function applyTheme() {
  const t = themePref();
  const dark = t === 'dark' || (t === 'auto' && darkQuery && darkQuery.matches);
  ROOT.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = dark ? '#000000' : '#ffffff';
}
function setTheme(t) { try { localStorage.setItem('hq.theme', JSON.stringify(t)); } catch (e) {} applyTheme(); }
if (darkQuery) { try { darkQuery.addEventListener('change', applyTheme); } catch (e) { darkQuery.addListener(applyTheme); } }
applyTheme();

/* ================= connection ================= */
const Conn = {
  endpoint: () => LS.get('endpoint', ''),
  token: () => LS.get('token', ''),
  key: () => LS.get('key', ''),
  paired: () => !!(LS.get('endpoint', '') && LS.get('token', '')),
  canLog: () => !!(LS.get('endpoint', '') && (LS.get('token', '') || LS.get('key', '')))
};

async function rawPost(endpoint, body, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 30000);
  try {
    const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function api(body) {
  const endpoint = Conn.endpoint(), token = Conn.token(), key = Conn.key();
  if (!endpoint || !(token || key)) throw new Error('Not paired');
  const res = await rawPost(endpoint, Object.assign(token ? { token } : { key }, body));
  if (res && res.auth === false && token) onUnpaired();
  return res;
}

async function dash(fn, args) {
  if (!Conn.paired()) throw new Error('This icon isn’t paired yet.');
  const res = await api({ action: 'dash', fn, args: args || [] });
  if (!res || !res.success) {
    const err = new Error((res && res.error) || 'No answer from Google. Try again.');
    err.permanent = !!(res && res.permanent);
    throw err;
  }
  return res.result;
}

function clearSavedCopies() {
  try { Object.keys(localStorage).filter((k) => k.indexOf('hl.cache.') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
}

function onUnpaired() {
  LS.del('token'); LS.del('device'); clearSavedCopies();
  toast('This icon was unpaired. Pair it again in Settings.');
  showView(view === 'settings' ? 'settings' : view);
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Phone';
  const standalone = (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  return kind + ' · ' + (START === 'today' ? 'Today' : 'Health log') + (standalone ? '' : ' (browser)');
}

/* ================= views ================= */
let view = null, lastMainView = START;
function showView(v) {
  view = v;
  if (v !== 'settings') lastMainView = v;
  ['today', 'ahead', 'money', 'trends', 'log', 'settings'].forEach((name) => { const el = $(name + '-view'); if (el) el.hidden = name !== v; });
  $('tabbar').hidden = v === 'settings';
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === v ? 'page' : 'false'));
  if (v === 'today') todayEnter();
  else if (v === 'ahead') aheadEnter();
  else if (v === 'money') moneyEnter();
  else if (v === 'log') { logRender(); logMoreRender(); }
  else if (v === 'trends') trendsEnter();
  else settingsRender();
}
document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => {
  if (view === b.dataset.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  showView(b.dataset.tab); window.scrollTo(0, 0);
}));
function openSettings(mode) { settingsMode = mode || 'settings'; showView('settings'); window.scrollTo(0, 0); }

/* ================= toast ================= */
let toastTimer = null;
function toast(text, undoId) {
  $('toast-text').textContent = text;
  const b = $('toast-btn');
  b.hidden = !undoId;
  b.dataset.v = undoId || '';
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undoId ? UNDO_MS : 3000);
}
$('toast-btn').addEventListener('click', () => { const id = $('toast-btn').dataset.v; if (id) logUndo(id); });

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ================= settings + pairing ================= */
let settingsMode = 'settings', unpairArmed = false, devices = null, devicesError = '';

function settingsRender() {
  const el = $('settings-view');
  if (settingsMode === 'pair') { el.innerHTML = pairMarkup(); return; }
  const t = themePref();
  const dev = LS.get('device', null);
  const state = Conn.paired()
    ? 'Paired as <b>' + esc(dev && dev.name ? dev.name : 'this icon') + '</b>.'
    : Conn.key() ? 'Health log is using the older shared key. Pair this icon to switch on Today and drop the key from this phone.'
      : 'Not paired yet.';
  el.innerHTML =
    '<header><h1>Settings</h1><button type="button" class="log" data-act="done">Done</button></header>' +
    '<h2>APPEARANCE</h2><div class="grid3" role="group" aria-label="Appearance">' +
      [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match phone']].map(([v, l]) =>
        '<button type="button" class="seg" data-act="theme" data-v="' + v + '" aria-pressed="' + (t === v) + '">' + l + '</button>').join('') + '</div>' +
    '<h2>THIS ICON</h2><div class="notice">' + state +
      '<div class="row2" style="margin-top:10px"><button type="button" class="seg" data-act="pair-open">' + (Conn.paired() ? 'Pair again' : 'Pair this icon') + '</button>' +
      (Conn.paired() ? '<button type="button" class="seg" data-act="unpair">' + (unpairArmed ? 'Tap again to unpair' : 'Unpair') + '</button>' : '') + '</div></div>' +
    (Conn.paired() ? '<h2>PAIRED DEVICES</h2>' + devicesMarkup() : '') +
    '<h2>OTHER FILES</h2>' + fileLinks([['Works &amp; Royalties', LINKS.works], ['Inventory', LINKS.inventory], ['Life HQ sheet', LINKS.hqSheet]]) +
    '<h2>ABOUT</h2><p class="small">Life HQ app ' + esc(APP_VERSION) + '. Each Home Screen icon is paired on its own. Pages show saved copies instantly, then refresh. Health records go straight to your health tracker.</p>' +
    '<div class="row2"><button type="button" class="seg" data-act="update">Check for update</button><button type="button" class="seg" id="test-celebration" data-act="celebrate">Test celebration</button></div>';
  if (Conn.paired() && devices === null && !devicesError) loadDevices();
}

function devicesMarkup() {
  if (devicesError) return '<p class="small">' + esc(devicesError) + '</p>';
  if (!devices) return '<p class="small">Loading…</p>';
  const me = (LS.get('device', null) || {}).id;
  return devices.map((d) => '<div class="dev"><span>' + esc(d.name) + '<small>' + (d.id === me ? 'This icon · ' : '') + 'last used ' + esc(d.lastUsed || '–') + '</small></span>' +
    (d.id === me ? '' : '<button type="button" class="link-btn" data-act="revoke" data-v="' + esc(d.id) + '">Unpair</button>') + '</div>').join('') +
    '<p class="small" style="margin-top:8px">Unpair anything you don’t recognise. Pairings are also listed in Life HQ › Device access.</p>';
}

async function loadDevices() {
  try {
    const res = await api({ action: 'devices' });
    if (res && res.success) { devices = res.devices; const d = LS.get('device', {}) || {}; d.id = res.me; LS.set('device', d); }
    else devicesError = (res && res.error) || 'Couldn’t load devices.';
  } catch (e) { devicesError = 'Couldn’t load devices (offline?).'; }
  if (view === 'settings' && settingsMode === 'settings') settingsRender();
}

function pairMarkup() {
  return '<header><h1>Pair this icon</h1><button type="button" class="seg" data-act="pair-cancel" style="padding:0 14px">Cancel</button></header>' +
    '<form id="pair-form" class="stack">' +
    '<p>On your Mac: open the <b>Ru - Inbox Receiver</b> script, choose <b>pairNewDevice</b> in the function menu and press <b>Run</b>. Copy the line starting <b>HQ1.</b> from the log and paste it here.</p>' +
    '<p class="small">A code works for 15 minutes, for up to two icons. Each Home Screen icon needs pairing once.</p>' +
    '<label for="pair-code">Setup code</label>' +
    '<input id="pair-code" class="text-input code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="HQ1.…">' +
    (navigator.clipboard && navigator.clipboard.readText ? '<button type="button" class="seg" data-act="paste">Paste</button>' : '') +
    '<label for="pair-name">Name for this icon</label>' +
    '<input id="pair-name" class="text-input" type="text" maxlength="40" autocomplete="off" value="' + esc(defaultDeviceName()) + '">' +
    '<button type="submit" class="log wide" id="pair-btn" style="margin-top:12px">Pair</button></form>';
}

async function pairSubmit() {
  const raw = $('pair-code').value.trim();
  const m = raw.match(/HQ1\.([A-Za-z0-9_-]{10,})\.([A-Za-z0-9-]{10,13})\s*$/i);
  if (!m) { toast('Paste the whole line that starts HQ1.'); return; }
  const endpoint = 'https://script.google.com/macros/s/' + m[1] + '/exec';
  const name = $('pair-name').value.trim() || defaultDeviceName();
  const btn = $('pair-btn');
  btn.disabled = true; btn.textContent = 'Pairing…';
  let res = null;
  try { res = await rawPost(endpoint, { action: 'pair', code: m[2], name }); } catch (e) { res = null; }
  if (res && res.success && res.token) {
    LS.set('endpoint', endpoint); LS.set('token', res.token); LS.set('device', { id: res.id, name: res.name });
    LS.del('key'); devices = null; devicesError = ''; clearSavedCopies();
    toast('Paired ✓');
    T.lastLoad = 0; T.loadedDate = '';
    showView(lastMainView);
    logRefreshConfig(); logFlush();
  } else {
    btn.disabled = false; btn.textContent = 'Pair';
    toast(res && res.error ? res.error : res ? 'Not paired. Is the receiver updated and deployed?' : 'Couldn’t reach Google. Check the code and your connection.');
  }
}

async function settingsAct(el) {
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'done') { unpairArmed = false; showView(lastMainView); }
  else if (act === 'theme') { setTheme(v); settingsRender(); }
  else if (act === 'pair-open') { settingsMode = 'pair'; settingsRender(); }
  else if (act === 'pair-cancel') { settingsMode = 'settings'; showView(lastMainView); }
  else if (act === 'paste') { try { $('pair-code').value = (await navigator.clipboard.readText()).trim(); } catch (e) { toast('Couldn’t paste. Long-press the box and choose Paste.'); } }
  else if (act === 'unpair') {
    if (!unpairArmed) { unpairArmed = true; settingsRender(); setTimeout(() => { unpairArmed = false; if (view === 'settings' && settingsMode === 'settings') settingsRender(); }, 4000); return; }
    unpairArmed = false;
    const me = (LS.get('device', null) || {}).id;
    try { if (me) await api({ action: 'revoke', id: me }); } catch (e) {}
    LS.del('token'); LS.del('device'); clearSavedCopies(); devices = null;
    toast('Unpaired'); settingsRender();
  } else if (act === 'revoke') {
    el.disabled = true;
    try { const res = await api({ action: 'revoke', id: v }); if (!res || !res.success) throw new Error(); devices = devices.filter((d) => d.id !== v); toast('Unpaired'); }
    catch (e) { toast('Couldn’t unpair that device'); }
    settingsRender();
  } else if (act === 'celebrate') { await prepareCompletionAudio(); celebrateCompletion();
  } else if (act === 'update') {
    toast('Checking…');
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    setTimeout(() => location.reload(), 900);
  }
}

/* ================= LOG view ================= */
const FALLBACK = {
  meds: [{ name: 'Celecoxib', strength: '200 mg', perDay: 2 }, { name: 'Omeprazole', strength: '20 mg', perDay: 1 },
    { name: 'Elvanse', strength: '30 mg', perDay: 1 }, { name: 'Amitriptyline', strength: '10 mg', perDay: 1 },
    { name: 'Symprove', strength: '70 ml', perDay: 1 }],
  foods: ['Green apple', 'Dark chocolate', 'Cashews', 'Onigiri', 'Samosa', 'Coffee with oat milk', 'Chai with oat milk'],
  trial: null, today: { meds: {}, wakeAt: '', lastCheckin: '' }
};
const SCALES = [['pain', 'Pain'], ['stiff', 'Stiffness'], ['fatigue', 'Fatigue'], ['fog', 'Brain fog'], ['headache', 'Headache'],
  ['mood', 'Mood'], ['bloat', 'Bloating'], ['stomach', 'Stomach pain'], ['screen', 'Screen time']];
const SLEEP = [['sleepq', 'Sleep quality', 10], ['disturb', 'Sleep disturbed', 5]];
const DAY_START_HOUR = 4;
const healthKey = (d) => dayKey(new Date(d.getTime() - DAY_START_HOUR * 3600000));
const keyToDate = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
const addDays = (k, n) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const newId = () => 'app_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

let cached = LS.get('config', null);
let cfg = cached && cached.data ? cached.data : FALLBACK;
if (!cached || cached.day !== dayKey(new Date())) cfg = Object.assign({}, cfg, { today: { meds: {}, wakeAt: '', lastCheckin: '' } });
let recent = LS.get('recent', []).filter((r) => r.day >= dayKey(new Date(Date.now() - 2 * 86400000)));
let queue = LS.get('queue', []);
const pending = {};
let sending = false;

function guessPeriod() {
  const h = new Date().getHours();
  if (h >= 22 || h < 4) return 'Bed';
  if (h < 14 && !cfg.today.wakeAt && !recent.some((r) => r.day === dayKey(new Date()) && r.wake)) return 'Wake';
  return 'Day';
}

const S = {
  open: false, period: null, scores: {}, checkNote: '', calMed: null,
  bristol: null, size: null, urgent: false, bowelNote: '',
  meds: [], doses: {}, food: '', time: null, timeOpen: false
};

/* Medicines with several doses ("15 mg / 30 mg"): the first is preselected. */
/* Strengths are separated by " / " with spaces, so "15/500 mg / 30/500 mg" gives two. */
const medOptions = (m) => (Array.isArray(m.options) && m.options.length ? m.options : String(m.strength || '').split(/\s+\/\s+/)).filter(Boolean);
const maxTabs = (m) => Number(m.maxTabs) || 0;
const isDosed = (m) => medOptions(m).length > 1 || maxTabs(m) > 0;
/* Chosen dose as stored in Events: "2 × 15/500 mg" (tablet count) or "30 mg" (strength choice). */
function doseText(m) {
  const d = S.doses[m.name] || {};
  const strength = d.s || medOptions(m)[0] || m.strength;
  return maxTabs(m) ? (d.n || maxTabs(m)) + ' × ' + strength : strength;
}
function doseShort(opts) {
  const plain = opts.map((o) => o.match(/^(\d+(?:\.\d+)?)\s*([a-zµ]+)$/i));
  if (plain.every((x) => x && x[2] === plain[0][2])) return plain.map((x) => x[1]).join(' / ') + ' ' + plain[0][2];
  const times = opts.map((o) => o.match(/^(\d+)\s*[×x]\s*(.+)$/));
  if (times.every((x) => x && x[2] === times[0][2])) {
    const n = times.map((x) => Number(x[1]));
    return Math.min.apply(null, n) + '–' + Math.max.apply(null, n) + ' × ' + times[0][2];
  }
  return opts.join(' / ');
}
function doseMg(dose) {
  const m = String(dose || '').match(/(?:(\d+)\s*[×x*]\s*)?(\d+(?:\.\d+)?)(?:\s*\/\s*\d+(?:\.\d+)?)*\s*mg/i);
  return m ? (m[1] ? Number(m[1]) : 1) * Number(m[2]) : null;
}

function trialView() {
  const t = cfg.trial;
  if (!t || !t.name) return '';
  const now = new Date();
  const today = dayKey(now);
  const localDone = recent.find((r) => r.day === today && r.kind === 'trial' && r.status !== 'failed');
  const doneAt = t.buttonDoneAt || (localDone ? localDone.hm : '');
  const woke = cfg.today.wakeAt || recent.some((r) => r.day === today && r.wake && r.status !== 'failed');
  const inWindow = hm(now) >= (t.from || '00:00') && hm(now) <= (t.until || '23:59');
  const showBtn = t.button && !doneAt && inWindow && (!t.needsWake || woke);
  return '<section class="trial" aria-label="Current trial">' +
    '<div class="trial-top"><span>CURRENT TRIAL</span>' + (t.ends ? '<span>ends ' + esc(t.ends) + '</span>' : '') + '</div>' +
    '<div class="trial-name">' + esc(t.name) + (t.day ? ' · day ' + esc(t.day) + (t.length ? ' of ' + esc(t.length) : '') : '') + '</div>' +
    (t.focus ? '<div class="trial-focus">Focus: ' + esc(t.focus) + '</div>' : '') +
    (showBtn ? '<button type="button" class="trial-btn" data-act="trial">' + esc(t.button) + '</button>' : '') +
    (doneAt && t.button ? '<div class="trial-today">' + esc(t.button.replace(/ now$/i, '')) + ' at ' + esc(doneAt) + ' · logged</div>' : '') +
    '</section>';
}

/* Medication history: health days (before 04:00 counts as the previous day). */
function medCounts() {
  const h = cfg.history;
  if (!h || !Array.isArray(h.meds)) return null;
  const map = {};
  h.meds.forEach((m) => {
    const byDay = {}, mg = Array.isArray(m.mg) ? {} : null, unknown = {};
    (m.counts || []).forEach((n, i) => { if (n) byDay[addDays(h.startKey, i)] = n; });
    if (mg) m.mg.forEach((n, i) => { const k = addDays(h.startKey, i); if (n) mg[k] = n; if ((m.mgUnknown || [])[i]) unknown[k] = true; });
    recent.forEach((r) => {
      if (r.kind === 'meds' && r.status !== 'saved' && r.status !== 'failed' && (r.meds || []).includes(m.name)) {
        const k = r.hday || r.day; byDay[k] = (byDay[k] || 0) + 1;
        if (mg) { const n = doseMg((r.doses || {})[m.name]); if (n === null) unknown[k] = true; else mg[k] = (mg[k] || 0) + n; }
      }
    });
    map[m.name] = { perDay: m.perDay || 1, byDay, mg, unknown };
  });
  return map;
}

function historyView() {
  const data = medCounts();
  if (!data || !Object.keys(data).length) return '';
  const today = healthKey(new Date());
  const keys = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const L = 'SMTWTFS';
  const cls = (n, per, k) => (n >= per ? 'on' : n > 0 ? 'part' : '') + (k === today ? ' today' : '');
  let html = '<div class="hist" aria-label="Medication history, last 14 days">' +
    '<div class="hist-row head"><span class="small">Last 14 days</span><span class="hist-letters" aria-hidden="true">' +
    keys.map((k) => (k === today ? '<b>' : '<span>') + L[keyToDate(k).getDay()] + (k === today ? '</b>' : '</span>')).join('') + '</span><span></span></div>';
  Object.keys(data).forEach((name) => {
    const d = data[name];
    const taken = keys.filter((k) => (d.byDay[k] || 0) > 0).length;
    html += '<button type="button" class="hist-row" data-act="cal" data-v="' + esc(name) + '" aria-expanded="' + (S.calMed === name) + '" aria-label="' + esc(name) + ': logged on ' + taken + ' of the last 14 days. Show calendar">' +
      '<span class="hist-name">' + esc(name) + '</span><span class="hist-cells">' +
      keys.map((k) => '<span class="' + cls(d.byDay[k] || 0, d.perDay, k) + '"></span>').join('') + '</span>' +
      '<span class="hist-n">' + taken + '/14</span></button>';
    if (S.calMed === name) html += calendarView(name, d, today, cls);
  });
  return html + '</div>';
}

function calendarView(name, d, today, cls) {
  const first = addDays(today, -41);
  const offset = (keyToDate(first).getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const total = offset + 42 + (6 - (keyToDate(today).getDay() + 6) % 7);
  let cells = '';
  for (let i = 0; i < total; i++) {
    const k = addDays(start, i);
    if (k < first || k > today) { cells += '<span class="d blank"></span>'; continue; }
    const n = d.byDay[k] || 0;
    const date = keyToDate(k);
    const label = date.getDate() === 1 ? '<small style="font-size:11px">1 ' + date.toLocaleDateString('en-GB', { month: 'short' }) + '</small>' : date.getDate();
    const amount = d.mg && n ? (d.mg[k] ? d.mg[k] + (d.unknown[k] ? '+' : '') : '?') : '';
    cells += '<span class="d ' + cls(n, d.perDay, k) + (d.mg ? ' dosed' : '') + '" title="' + esc(k) + (n ? ': ' + n + (amount ? ' · ' + amount + ' mg' : '') : '') + '">' +
      (d.mg ? '<span>' + label + '</span><i>' + amount + '</i>' : label) + '</span>';
  }
  const count = (days) => Array.from({ length: days }, (_, i) => addDays(today, -i)).filter((k) => (d.byDay[k] || 0) > 0).length;
  const week = d.mg ? Array.from({ length: 7 }, (_, i) => addDays(today, -i)).reduce((t, k) => t + (d.mg[k] || 0), 0) : 0;
  return '<div class="cal"><div class="cal-sum">' + esc(name) + ' · last 7 days ' + count(7) + ' · last 14 ' + count(14) + ' · last 6 weeks ' + count(42) +
    (d.mg ? ' · 7-day total ' + week + ' mg' : '') + '</div>' +
    '<div class="cal-grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<span class="dow">' + x + '</span>').join('') + cells + '</div>' +
    '<div class="cal-sum">Dark = logged' + (d.mg ? ' · small number = mg that day (? = dose not recorded)' : '') + (d.perDay > 1 ? ' · half = some of ' + d.perDay + ' doses' : '') + ' · before 4am counts as the night before</div></div>';
}

function checkinView() {
  const period = S.period || guessPeriod();
  const last = cfg.today.lastCheckin ? 'Last: ' + cfg.today.lastCheckin.toLowerCase() : 'None yet today';
  let html = '<section class="card" aria-label="Check-in">' +
    '<button type="button" class="check-toggle" data-act="toggle" aria-expanded="' + S.open + '" aria-controls="check-body">' +
    '<span aria-hidden="true"></span><span><h2>Check-in</h2><span class="sub">' + (S.open ? 'Leave anything blank you didn’t notice' : esc(last) + ' · tap to open') + '</span></span>' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
  if (S.open) {
    const list = (period === 'Wake' ? SLEEP.map(([k, l, m]) => [k, l, m]) : []).concat(SCALES.map(([k, l]) => [k, l, 10]));
    html += '<div id="check-body" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="grid3" role="group" aria-label="When">' + ['Wake', 'Day', 'Bed'].map((p) =>
        '<button type="button" class="seg" data-act="period" data-v="' + p + '" aria-pressed="' + (period === p) + '">' + p + '</button>').join('') + '</div><div>' +
      list.map(([k, l, max]) => {
        const v = S.scores[k];
        const set = v !== undefined;
        return '<div class="scale"><label for="r-' + k + '">' + l + '</label>' +
          '<input id="r-' + k + '" type="range" min="0" max="' + max + '" step="0.5" value="' + (set ? v : max / 2) + '" data-score="' + k + '"' + (set ? '' : ' class="unset"') + '>' +
          '<output id="o-' + k + '" for="r-' + k + '"' + (set ? '' : ' class="unset"') + '>' + (set ? v : '–') + '</output></div>';
      }).join('') + '</div>' +
      '<input type="text" data-field="checkNote" value="' + esc(S.checkNote) + '" placeholder="Note (optional)" aria-label="Check-in note" autocomplete="off">' +
      '<button type="button" class="log wide" id="check-save" data-act="checkin"></button></div>';
  }
  return html + '</section>';
}

function logRender() {
  if (view !== 'log') return;
  if (!$('log-main')) { $('log-view').innerHTML = '<div id="log-main"></div><div id="log-more" class="log-more"></div>'; }
  const app = $('log-main');
  const head = (actions) => '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' + actions +
    '<button type="button" class="icon-btn" data-act="settings" aria-label="Settings">' + GEAR + '</button></div></div><h1 class="page-title">Health log</h1>';
  if (!Conn.canLog()) {
    app.innerHTML = head('') + '<div class="notice">Pair this icon once to start logging. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
      '<button type="button" class="log wide" data-act="pair">Pair this icon</button></div>';
    return;
  }
  const now = new Date();
  const today = dayKey(now);
  const timeLabel = S.time ? (dayKey(S.time) === today ? '' : S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(S.time) : 'Now · ' + hm(now);
  const medsChosen = S.meds.length;
  const rows = recent.filter((r) => r.day === today).slice(0, 5);
  const waiting = queue.length;
  app.innerHTML =
    head('<button type="button" class="pill' + (S.time ? ' set' : '') + '" data-act="time" aria-expanded="' + S.timeOpen + '" aria-label="Time for the next entry: ' + esc(timeLabel) + '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' + esc(timeLabel) + '</button>') +
    (S.timeOpen ? '<div class="time-panel"><label for="time-input" class="small">Time for the next entry</label>' +
      '<input id="time-input" type="datetime-local" value="' + localInputValue(S.time || now) + '" max="' + localInputValue(new Date(now.getTime() + 10 * 60000)) + '">' +
      '<div class="btns"><button type="button" class="log" data-act="time-set">Use this time</button><button type="button" class="seg" data-act="time-now">Now</button></div></div>' : '') +
    trialView() + checkinView() +
    '<section class="card" aria-label="Medication"><div class="card-head"><h2>Medication</h2><button type="button" class="log" data-act="meds"' + (medsChosen ? '' : ' disabled') + '>' + (medsChosen ? 'Log ' + medsChosen : 'Log') + '</button></div>' +
      '<div class="chips">' + (cfg.meds || []).map((m) =>
        '<button type="button" class="chip" data-act="med" data-v="' + esc(m.name) + '" aria-pressed="' + S.meds.includes(m.name) + '"><b>' + esc(m.name) + '</b>' + chipDose(m) + takenMark(m) + '</button>').join('') +
        '<button type="button" class="chip other" data-act="other-med">Other…</button></div>' +

      doseRows() + historyView() + '</section>' + bowelView() +
    '<section class="card" aria-label="Food"><h2>Food</h2>' +
      '<div class="inline-row"><input type="text" id="food-input" data-field="food" value="' + esc(S.food) + '" placeholder="What did you eat?" aria-label="What did you eat" autocomplete="off" enterkeyhint="done">' +
      '<button type="button" class="log" id="food-log" data-act="food"' + (S.food.trim() ? '' : ' disabled') + '>Log</button></div>' +
      '<div class="chips">' + (cfg.foods || []).map((f) => '<button type="button" class="chip food" data-act="food-chip" data-v="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div></section>' +
    (waiting ? '<div class="queue-note"><span>' + waiting + ' waiting to send</span><button type="button" class="link-btn" data-act="flush">Send now</button></div>' : '') +
    (rows.length ? '<section class="recent" aria-label="Logged today"><h2>LOGGED TODAY</h2>' + rows.map((r) =>
      '<div class="lrow"><span class="t">' + esc(r.hm) + '</span><span>' + esc(r.text) + '</span>' +
      (r.status === 'pending' ? '<button type="button" class="link-btn" data-act="undo" data-v="' + esc(r.id) + '">Undo</button>' :
        '<span class="st' + (r.status === 'failed' ? ' bad' : '') + '">' + (r.status === 'saved' ? 'Saved' : r.status === 'failed' ? 'Not saved' : 'Waiting') + '</span>') + '</div>').join('') + '</section>' : '') +
    '';
  updateCheckButton();
}

/* Logged today (this health day, 4am cut-off): ✓ when done, "1/2" part-way for twice-daily medicines. */
function takenMark(m) {
  const hk = healthKey(new Date());
  let n = ((cfg.today || {}).meds || {})[m.name] || 0;
  n += recent.filter((r) => r.kind === 'meds' && r.hday === hk && r.status !== 'saved' && r.status !== 'failed' && (r.meds || []).includes(m.name)).length;
  if (!n) return '';
  const per = m.perDay || 1;
  const asNeeded = isDosed(m);
  const text = !asNeeded && n < per ? n + '/' + per : n > 1 && asNeeded ? '✓' + n : '✓';
  return '<span class="taken" aria-label="' + (n < per && !asNeeded ? n + ' of ' + per + ' logged today' : 'logged today' + (n > 1 ? ', ' + n + ' times' : '')) + '">' + text + '</span>';
}

/* Compact chips: the strength only appears once a medicine is selected. */
function chipDose(m) {
  if (!S.meds.includes(m.name)) return '';
  const text = isDosed(m) ? doseText(m) : m.strength;
  return text ? '<small>' + esc(text) + '</small>' : '';
}

function doseRows() {
  const rows = (cfg.meds || []).filter((m) => S.meds.includes(m.name) && isDosed(m));
  return rows.map((m) => {
    const d = S.doses[m.name] || {};
    const opts = medOptions(m);
    const strength = d.s || opts[0];
    const count = d.n || maxTabs(m);
    const seg = (key, value, label, on) => '<button type="button" class="seg" data-act="dose" data-v="' + esc(m.name) + '" data-k="' + key + '" data-dose="' + esc(value) + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
    return '<div class="dose-row" role="group" aria-label="' + esc(m.name) + ' dose"><span>' + esc(m.name) + '</span>' +
      (opts.length > 1 ? opts.map((o) => seg('s', o, o.replace(/\s*mg$/i, ''), o === strength)).join('') : '') +
      (maxTabs(m) ? (opts.length > 1 ? '<i class="dose-gap"></i>' : '') + Array.from({ length: maxTabs(m) }, (_, i) => seg('n', String(i + 1), (opts.length > 1 ? '× ' + (i + 1) : (i + 1) + ' × ' + strength), count === i + 1)).join('') : '') +
      '</div>';
  }).join('');
}

function bowelView() {
  return '<section class="card bowel" aria-label="Bowel"><div class="card-head"><h2>Bowel</h2>' +
      '<button type="button" class="log" data-act="bowel"' + (S.bristol ? '' : ' disabled') + '>Log</button></div>' +
    '<div class="grid7" role="group" aria-label="Bristol type">' + [1, 2, 3, 4, 5, 6, 7].map((n) =>
      '<button type="button" class="sq" data-act="bristol" data-v="' + n + '" aria-pressed="' + (S.bristol === n) + '" aria-label="Bristol type ' + n + '">' + n + '</button>').join('') + '</div>' +
    (S.bristol ? '<div class="grid-size" role="group" aria-label="Size">' + ['Small', 'Medium', 'Large'].map((z) =>
      '<button type="button" class="seg" data-act="size" data-v="' + z + '" aria-pressed="' + (S.size === z) + '">' + z + '</button>').join('') +
      '<button type="button" class="seg" data-act="urgent" aria-pressed="' + S.urgent + '">Urgent</button></div>' +
      '<input type="text" data-field="bowelNote" value="' + esc(S.bowelNote) + '" placeholder="Note (optional)" aria-label="Bowel note" autocomplete="off">' : '') +
    '</section>';
}

function logMoreRender() {
  const more = $('log-more');
  if (!more) return;
  if (!more.dataset.built) {
    more.dataset.built = '1';
    more.innerHTML = '<div class="tv"><div class="recent-buttons"><button id="toggle-medication" type="button" aria-expanded="false" aria-controls="medications">Recent meds</button></div>' +
      '<div id="medications" aria-live="polite" hidden></div></div>' + fileLinks([['Health sheet', LINKS.healthSheet], ['Health GPT', LINKS.healthGpt]]);
    $('toggle-medication').onclick = () => {
      const open = $('medications').hidden;
      $('medications').hidden = !open;
      $('toggle-medication').setAttribute('aria-expanded', String(open));
      if (open) loadExtras();
    };
  }
  more.querySelector('.recent-buttons').hidden = !Conn.paired();
  if (!Conn.paired()) $('medications').hidden = true;
}

function localInputValue(d) { return dayKey(d) + 'T' + hm(d); }

function updateCheckButton() {
  const b = $('check-save');
  if (!b) return;
  const n = Object.keys(S.scores).length;
  b.disabled = !n;
  b.textContent = n ? 'Save check-in · ' + n + (n === 1 ? ' rating' : ' ratings') : 'Save check-in';
}

function saveLocal() { LS.set('recent', recent.slice(0, 40)); LS.set('queue', queue); }

function commit(kind, payload, label, extra) {
  const when = S.time || new Date();
  const entry = Object.assign({ kind, entryId: newId(), time: when.toISOString(), timeSet: !!S.time }, payload);
  recent.unshift(Object.assign({ id: entry.entryId, day: dayKey(when), hday: healthKey(when), hm: hm(when), text: label, kind, status: 'pending' }, extra || {}));
  S.time = null; S.timeOpen = false;
  saveLocal();
  pending[entry.entryId] = setTimeout(() => {
    delete pending[entry.entryId];
    queue.push(entry);
    setStatus(entry.entryId, 'waiting');
    logFlush();
  }, UNDO_MS);
  logRender();
  toast('Logging ' + label, entry.entryId);
}

function logUndo(id) {
  if (!pending[id]) return;
  clearTimeout(pending[id]);
  delete pending[id];
  recent = recent.filter((r) => r.id !== id);
  saveLocal();
  logRender();
  toast('Removed');
}

function setStatus(id, status, error) {
  const r = recent.find((x) => x.id === id);
  if (r) { r.status = status; if (error) r.error = error; }
  saveLocal();
  logRender();
}

async function logFlush() {
  if (sending || !queue.length || !navigator.onLine || !Conn.canLog()) { logRender(); return; }
  sending = true;
  let saved = 0, failedMsg = '';
  try {
    while (queue.length) {
      const entry = queue[0];
      let res;
      try { res = await api(Object.assign({ action: 'log' }, entry)); } catch (e) { res = null; }
      if (res && res.success) { queue.shift(); setStatus(entry.entryId, 'saved'); saved++; continue; }
      if (res && res.auth === false) { failedMsg = 'Not sent: this icon needs pairing again (Settings).'; break; }
      if (res && res.permanent) { queue.shift(); setStatus(entry.entryId, 'failed', res.error); failedMsg = res.error || 'Not saved'; continue; }
      if (res && res.error === 'Not authorised.') { failedMsg = 'Key not accepted. Pair this icon in Settings.'; }
      break;
    }
  } finally { sending = false; saveLocal(); }
  if (failedMsg) toast(failedMsg);
  else if (saved && $('toast').hidden) toast('Saved ✓');
  else if (queue.length && !navigator.onLine) toast('Saved on phone · will send when online');
  if (saved) logRefreshConfig();
  logRender();
}

async function logRefreshConfig() {
  if (!Conn.canLog()) return;
  try {
    const res = await api({ action: 'config' });
    if (res && res.success) {
      cfg = { meds: res.meds || FALLBACK.meds, foods: res.foods || [], trial: res.trial || null, history: res.history || null, symptoms: res.symptoms || null, today: res.today || FALLBACK.today };
      LS.set('config', { data: cfg, day: dayKey(new Date()) });
      logRender();
      if (view === 'trends') trendsRender();
      return true;
    }
  } catch (e) {}
  return false;
}

function logAct(el) {
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'toggle') { S.open = !S.open; if (S.open && !S.period) S.period = guessPeriod(); logRender(); }
  else if (act === 'period') { S.period = v; if (v !== 'Wake') { delete S.scores.sleepq; delete S.scores.disturb; } logRender(); }
  else if (act === 'bristol') { S.bristol = S.bristol === Number(v) ? null : Number(v); logRender(); }
  else if (act === 'size') { S.size = S.size === v ? null : v; logRender(); }
  else if (act === 'urgent') { S.urgent = !S.urgent; logRender(); }
  else if (act === 'med') {
    if (S.meds.includes(v)) { S.meds = S.meds.filter((x) => x !== v); delete S.doses[v]; }
    else {
      S.meds = S.meds.concat(v);
      const m = (cfg.meds || []).find((x) => x.name === v);
      if (m && isDosed(m)) S.doses[v] = { s: medOptions(m)[0], n: maxTabs(m) };
    }
    logRender();
  }
  else if (act === 'dose') {
    const d = S.doses[v] || {};
    if (el.dataset.k === 'n') d.n = Number(el.dataset.dose); else d.s = el.dataset.dose;
    S.doses[v] = d; logRender();
  }
  else if (act === 'cal') { S.calMed = S.calMed === v ? null : v; logRender(); }
  else if (act === 'other-med') { toast('Other medication: use the Siri inbox for now'); }
  else if (act === 'food-chip') { const f = S.food.trim().replace(/,$/, ''); S.food = f ? f + ', ' + v.toLowerCase() : v; logRender(); }
  else if (act === 'time') { S.timeOpen = !S.timeOpen; logRender(); }
  else if (act === 'time-now') { S.time = null; S.timeOpen = false; logRender(); }
  else if (act === 'time-set') {
    const val = $('time-input').value;
    const d = val ? new Date(val) : null;
    if (d && !isNaN(d) && d.getTime() <= Date.now() + 10 * 60000 && d.getTime() >= Date.now() - 3 * 86400000) { S.time = d; S.timeOpen = false; logRender(); }
    else toast('Pick a time in the last 3 days');
  }
  else if (act === 'settings') { openSettings(); }
  else if (act === 'pair') { openSettings('pair'); }
  else if (act === 'flush') { logFlush(); }
  else if (act === 'undo') { logUndo(v); }
  else if (act === 'bowel') {
    if (!S.bristol) return;
    const label = 'Bristol ' + S.bristol + (S.size ? ' · ' + S.size.toLowerCase() : '') + (S.urgent ? ' · urgent' : '');
    commit('bowel', { bristol: S.bristol, size: S.size || '', urgent: S.urgent, note: S.bowelNote.trim() }, label);
    S.bristol = null; S.size = null; S.urgent = false; S.bowelNote = ''; logRender();
  }
  else if (act === 'meds') {
    if (!S.meds.length) return;
    const chosen = (cfg.meds || []).filter((m) => S.meds.includes(m.name));
    // Dose choices need the v5 HealthLog script (it sends "options"); older ones would record the wrong dose.
    const stale = chosen.find((m) => (isDosed(m) || /paracetamol|co-?codamol|codeine/i.test(m.name)) && !('maxTabs' in m));
    if (stale) { toast(stale.name + ' needs the updated HealthLog script before it can be logged.'); return; }
    const doses = {};
    chosen.forEach((m) => { if (isDosed(m)) doses[m.name] = doseText(m); });
    const label = chosen.map((m) => m.name + (doses[m.name] ? ' ' + doses[m.name] : m.strength ? ' ' + m.strength : '')).join(', ');
    commit('meds', { meds: chosen.map((m) => m.name), doses }, label, { meds: chosen.map((m) => m.name), doses });
    S.meds = []; S.doses = {}; logRender();
  }
  else if (act === 'food') {
    const food = S.food.trim();
    if (!food) return;
    commit('food', { food }, food);
    S.food = ''; logRender();
  }
  else if (act === 'checkin') {
    const n = Object.keys(S.scores).length;
    if (!n) return;
    const period = S.period || guessPeriod();
    commit('checkin', { period, scores: Object.assign({}, S.scores), note: S.checkNote.trim() },
      'Check-in (' + period.toLowerCase() + ') · ' + n + (n === 1 ? ' rating' : ' ratings'), { wake: period === 'Wake' });
    S.scores = {}; S.checkNote = ''; S.open = false; S.period = null; logRender();
  }
  else if (act === 'trial') {
    const t = cfg.trial;
    if (!t) return;
    commit('trial', {}, t.button.replace(/ now$/i, ''));
  }
}

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.closest('#log-view')) return;
  if (el.dataset.score) {
    const k = el.dataset.score;
    S.scores[k] = Number(el.value);
    el.classList.remove('unset');
    const o = $('o-' + k); o.textContent = el.value; o.classList.remove('unset');
    updateCheckButton();
  } else if (el.dataset.field) {
    S[el.dataset.field] = el.value;
    if (el.dataset.field === 'food') { const b = $('food-log'); if (b) b.disabled = !el.value.trim(); }
  }
});

/* ================= TODAY view ================= */
const T = {
  tasks: [], loadedDate: '', rolloverMinutes: 40, choice: null, manual: false, req: 0, lastLoad: 0, built: false,
  completing: new Set(), pendingLog: null, saving: false, panelReq: {}
};
const TODOIST_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor"/><path d="M5 7.5 9 9.5 19 4.5 M5 12 9 14 19 9 M5 16.5 9 18.5 19 13.5" fill="none" style="stroke:var(--bg)" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const GPT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" fill-rule="evenodd"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>';
const REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

function todayMarkup() {
  return '<div class="top"><span class="eyebrow">LIFE DASHBOARD</span><div class="top-actions">' +
      '<a class="icon-btn" href="https://app.todoist.com/app/today" target="_blank" rel="noopener" aria-label="Open Todoist">' + TODOIST_SVG + '</a>' +
      '<a class="icon-btn" href="' + GPT_URL + '" target="_blank" rel="noopener" aria-label="Open Life HQ GPT">' + GPT_SVG + '</a>' +
      '<button type="button" class="icon-btn" id="refresh" aria-label="Refresh">' + REFRESH_SVG + '</button>' +
      '<button type="button" class="icon-btn" id="today-settings" aria-label="Settings">' + GEAR + '</button></div></div>' +
    '<div class="day-head"><div class="day-navigation">' +
      '<button id="previous-day" type="button" aria-label="Previous day" disabled>‹</button><h1 id="day-title">Today</h1>' +
      '<button id="next-day" type="button" aria-label="Next day" disabled>›</button></div>' +
      '<p class="muted" id="date">&nbsp;</p><button id="back-to-today" type="button" hidden>Back to today</button>' +
      '<div class="stale" id="stale"></div>' +
      '<button type="button" id="tomorrow-ready" class="tomorrow-ready" hidden>Tomorrow’s plan is ready ›</button></div>' +
    '<div id="pair-prompt" class="notice pair-prompt" hidden>Pair this icon once to see your day here. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
      '<button type="button" class="log wide" id="pair-today">Pair this icon</button></div>' +
    '<div id="today-body">' +
    '<div id="message" class="status" role="status" aria-live="polite"></div>' +
    '<div id="extras-status" class="status" role="status" aria-live="polite"></div>' +
    '<section id="day-notes" class="notes-panel" aria-label="Day notes" hidden></section>' +
    '<section id="day-calendar" aria-label="Calendar and plan" hidden></section>' +
    '<section id="today-tasks" class="task-list" aria-label="Tasks"><div id="focus"></div></section>' +
    '<section class="optional-section"><button id="toggle" type="button" aria-expanded="false" aria-controls="optional">Show optional work</button>' +
      '<div id="optional" hidden><h2>Optional</h2><div id="extra"></div></div></section>' +
    '<section id="logging" class="lower-section" aria-label="Inbox"><form id="log-form">' +
      '<textarea id="log-text" aria-label="Add something to your inbox" rows="2" maxlength="20000" placeholder="Add to inbox…"></textarea>' +
      '<div class="logging-actions"><button id="save-log" type="submit">Add to inbox</button></div>' +
      '<div id="log-status" class="status" role="status" aria-live="polite"></div></form>' +
      '<div id="inbox-queue" class="queue-note" hidden></div></section>' +
    '<section id="recent-section" class="lower-section"><div class="recent-buttons">' +
      '<button id="toggle-logs" type="button" aria-expanded="false" aria-controls="recent-logs">Recent inbox entries</button></div>' +
      '<div id="recent-logs" aria-live="polite" hidden></div>' + fileLinks([['Life HQ sheet', LINKS.hqSheet]]) + '</section>' +
    '</div>';
}

function buildToday() {
  $('today-view').innerHTML = todayMarkup();
  T.built = true;
  $('today-settings').onclick = () => openSettings();
  $('pair-today').onclick = () => openSettings('pair');
  $('refresh').onclick = () => { refreshToday(); };
  $('toggle').onclick = () => {
    const showing = $('optional').hidden;
    $('optional').hidden = !showing;
    $('toggle').textContent = showing ? 'Hide optional work' : 'Show optional work';
    $('toggle').setAttribute('aria-expanded', String(showing));
  };
  $('toggle-logs').onclick = () => {
    const open = $('recent-logs').hidden;
    $('recent-logs').hidden = !open;
    $('toggle-logs').setAttribute('aria-expanded', String(open));
    if (open) loadRecentLogs();
  };
  $('tomorrow-ready').onclick = () => browseDay(1);
  $('log-form').onsubmit = saveInbox;
  $('previous-day').onclick = () => browseDay(-1);
  $('next-day').onclick = () => browseDay(1);
  $('back-to-today').onclick = () => { T.choice = 'today'; T.manual = false; loadDay(true); };
  $('log-text').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    event.preventDefault();
    if (event.repeat) return;
    $('log-form').requestSubmit();
  });
}

function todayEnter() {
  if (!T.built) buildToday();
  const paired = Conn.paired();
  $('pair-prompt').hidden = paired;
  $('today-body').hidden = !paired;
  if (!paired) { $('date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); return; }
  if (!T.loadedDate || Date.now() - T.lastLoad > 120000) loadDay(false);
  else checkTomorrow();
  renderInboxQueue(); inboxFlush();
}

function refreshToday() {
  T.lastLoad = 0;
  loadDay(false);
  if (!$('recent-logs').hidden) loadRecentLogs();
  inboxFlush();
}

let messageTimer = null;
function message(text, clearAfter) {
  if (view !== 'today' || !$('message')) { if (text && !/…$/.test(text)) toast(text); return; }
  $('message').textContent = text;
  clearTimeout(messageTimer);
  if (clearAfter) messageTimer = setTimeout(() => { if ($('message').textContent === text) $('message').textContent = ''; }, clearAfter);
}

function londonWorkingDay(minutes) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const back = Number(parts.hour) * 60 + Number(parts.minute) < minutes ? 1 : 0;
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back)).toISOString().slice(0, 10);
}
function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
function browseDay(delta) {
  if (!T.loadedDate) return;
  T.choice = shiftDay(T.loadedDate, delta);
  T.manual = true;
  loadDay(true);
}
function stampTime(ms) { const d = new Date(ms); return (dayKey(d) === dayKey(new Date()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(d); }

/** Shows the saved copy at once (for the normal "today" view), then asks Google for a fresh one. */
async function loadDay(clear) {
  const request = ++T.req;
  const choice = T.choice;
  const usesCache = choice === null || choice === 'today';
  const tomorrowSaved = LS.get('cache.tomorrow', null);
  const saved = usesCache ? LS.get('cache.day', null) : (tomorrowSaved && tomorrowSaved.result && tomorrowSaved.result.date === choice ? tomorrowSaved : null);
  if (clear) {
    $('focus').replaceChildren(); $('extra').replaceChildren();
    $('day-calendar').hidden = true; $('day-notes').hidden = true;
  }
  if (saved && saved.result && (!usesCache || saved.result.workingDay === londonWorkingDay(T.rolloverMinutes)) && (clear || !T.loadedDate)) {
    try { renderDay(saved.result); } catch (e) {}
    $('stale').textContent = 'Saved copy from ' + stampTime(saved.at) + ' · updating…';
    message('');
  } else {
    if (!T.loadedDate || clear) message('Loading day…');
    $('stale').textContent = T.loadedDate && !clear ? 'Updating…' : '';
  }
  $('previous-day').disabled = true; $('next-day').disabled = true;
  try {
    const res = await dash('getDashboardDay', [choice]);
    if (request !== T.req) return;
    renderDay(res);
    T.lastLoad = Date.now();
    if (usesCache && !res.manualSelection) LS.set('cache.day', { at: Date.now(), result: res });
    $('stale').textContent = '';
    message('');
    checkTomorrow();
  } catch (e) {
    if (request !== T.req) return;
    $('previous-day').disabled = !T.loadedDate; $('next-day').disabled = !T.loadedDate;
    $('stale').textContent = T.loadedDate ? 'Couldn’t refresh · showing the last copy' : '';
    message((T.loadedDate ? '' : 'Cannot load day: ') + (T.loadedDate ? '' : e.message));
    if (T.loadedDate && Conn.paired()) toast('Couldn’t refresh: ' + e.message);
  }
}

function renderDay(res) {
  const [y, m, d] = res.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  $('date').textContent = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  T.loadedDate = res.date;
  T.rolloverMinutes = Number.isFinite(res.rolloverMinutes) ? res.rolloverMinutes : 40;
  const working = res.workingDay || res.date;
  T.manual = Boolean(res.manualSelection);
  $('day-title').textContent = res.date === working ? 'Today' : res.date === shiftDay(working, 1) ? 'Tomorrow' :
    res.date === shiftDay(working, -1) ? 'Yesterday' : date.toLocaleDateString('en-GB', { weekday: 'long' });
  $('back-to-today').hidden = !T.manual && res.date === working;
  $('previous-day').disabled = false; $('next-day').disabled = false;
  T.tasks = res.tasks || [];
  renderTasks();
  const plan = splitTimedPlanNotes(res.notes);
  $('day-notes').textContent = plan.notes.replace(/^\s+|\s+$/g, '');
  $('day-notes').hidden = !plan.notes.trim() || Boolean(res.notesError);
  $('extras-status').textContent = res.notesError || '';
  renderDayCalendar(res.calendar || [], res.calendarError || '', res.notesError ? [] : plan.suggestions);
  if (res.tasksError) $('focus').textContent = res.tasksError;
}

function splitTimedPlanNotes(value) {
  const original = String(value || '');
  try {
    const lines = original.split(/(\r\n|\n|\r)/), remaining = [], suggestions = [];
    const minutes = (time) => {
      const [hour, minute] = time.split(':').map(Number);
      return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
    };
    for (let i = 0; i < lines.length; i += 2) {
      const line = lines[i], newline = lines[i + 1] || '';
      const match = line.match(/^•\s*(\d{1,2}:\d{2})(?:\s*[–-]\s*(\d{1,2}:\d{2}))?\s+(.+)$/);
      if (match && match[3].trim() && minutes(match[1]) !== null && (!match[2] || minutes(match[2]) !== null)) {
        suggestions.push({ time: match[1] + (match[2] ? '–' + match[2] : ''), title: match[3], start: minutes(match[1]) });
      } else remaining.push(line + newline);
    }
    return { notes: remaining.join(''), suggestions };
  } catch (e) { return { notes: original, suggestions: [] }; }
}

function renderDayCalendar(entries, error, suggestions) {
  const panel = $('day-calendar');
  panel.replaceChildren();
  const items = entries.map((event, index) => {
    const time = String(event.time || '');
    const match = time.match(/(\d{1,2}):(\d{2})/);
    const start = /^All day\b/i.test(time) ? -1 : /^Continues\b/i.test(time) ? 0 : match ? Number(match[1]) * 60 + Number(match[2]) : Infinity;
    return Object.assign({}, event, { start, suggestion: false, index });
  }).concat((suggestions || []).map((item, index) => Object.assign({}, item, { suggestion: true, index })));
  items.sort((a, b) => a.start - b.start || Number(a.suggestion) - Number(b.suggestion) || a.index - b.index);
  panel.hidden = !items.length && !error;
  if (error) { const w = document.createElement('p'); w.className = 'status'; w.textContent = error; panel.appendChild(w); }
  items.forEach((event) => {
    const row = document.createElement('div'); row.className = 'selected-calendar-row' + (event.suggestion ? ' plan-suggestion' : '');
    const time = document.createElement('span'); time.className = 'ahead-time'; time.textContent = event.time;
    const content = document.createElement('div');
    const title = document.createElement('div'); title.textContent = event.title; content.appendChild(title);
    if (event.location) { const place = document.createElement('div'); place.className = 'sub'; place.textContent = event.location; content.appendChild(place); }
    row.append(time, content); panel.appendChild(row);
  });
}

async function completeTodoist(id, check, row, after) {
  if (T.completing.has(id)) return;
  T.completing.add(id);
  check.disabled = true;
  if (row) row.classList.add('done');
  prepareCompletionAudio();
  message('Saving completion…');
  try {
    await dash('completeTask', [id]);
    T.req++;                                   // ignore any older day response still in flight
    T.completing.delete(id);
    T.tasks = T.tasks.filter((t) => t.id !== id);
    const saved = LS.get('cache.day', null);
    if (saved && saved.result) { saved.result.tasks = (saved.result.tasks || []).filter((t) => t.id !== id); LS.set('cache.day', saved); }
    if (T.built) renderTasks();
    if (after) after();
    if ($('next-days') && after !== loadNextFewDays && T.aheadAt) loadNextFewDays();
    message('Completed in Todoist.', 5000);
    try { celebrateCompletion(); } catch (e) {}
  } catch (e) {
    T.completing.delete(id);
    check.checked = false; check.disabled = false;
    if (row) row.classList.remove('done');
    message('Could not complete: ' + e.message);
  }
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = 'task';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.id = 'task-' + task.id;
  check.setAttribute('aria-label', 'Complete ' + task.name);
  check.disabled = T.completing.has(task.id);
  check.checked = T.completing.has(task.id);
  const label = document.createElement('label');
  label.htmlFor = check.id;
  const name = document.createElement('div');
  name.textContent = task.name;
  label.appendChild(name);
  if (task.description) {
    const desc = document.createElement('div');
    desc.className = 'sub';
    desc.textContent = task.description.slice(0, 120);
    label.appendChild(desc);
  }
  const duration = document.createElement('span');
  duration.className = 'duration';
  duration.textContent = task.duration ? task.duration + ' min' : '';
  check.onchange = () => { if (check.checked) completeTodoist(task.id, check, row); };
  row.append(check, label, duration);
  return row;
}

function renderTasks() {
  $('focus').replaceChildren(); $('extra').replaceChildren();
  const core = T.tasks.filter((t) => !t.optional), extra = T.tasks.filter((t) => t.optional);
  core.forEach((t) => $('focus').appendChild(taskRow(t)));
  extra.forEach((t) => $('extra').appendChild(taskRow(t)));
  if (!core.length) $('focus').textContent = 'Nothing selected for this day.';
  if (!extra.length) $('extra').textContent = 'No optional tasks selected.';
}

setInterval(() => {
  if (view !== 'today' || !T.loadedDate || T.manual || !Conn.paired()) return;
  if (londonWorkingDay(T.rolloverMinutes) !== T.loadedDate) { T.choice = null; loadDay(true); }
}, 60000);

/* ---------- inbox ---------- */
/* Inbox: saved on the phone first, then sent (safe to retry: the entry ID stops duplicates). */
let inboxQueue = LS.get('inboxQueue', []);
let inboxSending = false;
function renderInboxQueue() {
  const el = $('inbox-queue');
  if (!el) return;
  el.hidden = !inboxQueue.length;
  el.innerHTML = inboxQueue.length ? '<span>' + inboxQueue.length + ' inbox entr' + (inboxQueue.length === 1 ? 'y' : 'ies') + ' saved on this phone, waiting to send</span><button type="button" class="link-btn" id="inbox-send">Send now</button>' : '';
  if (inboxQueue.length) $('inbox-send').onclick = () => inboxFlush(true);
}
function saveInbox(event) {
  event.preventDefault();
  const text = $('log-text').value;
  if (!text.trim()) { $('log-status').textContent = 'Enter something to save.'; return; }
  inboxQueue.push({ text, id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) });
  LS.set('inboxQueue', inboxQueue);
  $('log-text').value = '';
  $('log-status').textContent = navigator.onLine ? 'Sending…' : 'Saved on this phone · will send when online.';
  renderInboxQueue();
  inboxFlush(true);
}
async function inboxFlush(manual) {
  if (inboxSending || !inboxQueue.length || !Conn.paired()) return;
  if (!navigator.onLine) { if (manual && $('log-status')) $('log-status').textContent = 'Saved on this phone · will send when online.'; return; }
  inboxSending = true;
  let sent = 0, problem = '';
  try {
    while (inboxQueue.length) {
      const item = inboxQueue[0];
      try {
        const res = await dash('saveDashboardLog', [item.text, item.id]);
        if (!res || !res.success) throw new Error('Unexpected server response');
        inboxQueue.shift(); sent++;
        LS.set('inboxQueue', inboxQueue);
      } catch (e) {
        if (!e.permanent) { problem = 'Saved on this phone · couldn’t reach Google yet. It will retry.'; break; }
        inboxQueue.shift();
        LS.set('inboxQueue', inboxQueue);
        if ($('log-text') && !$('log-text').value.trim()) $('log-text').value = item.text;
        problem = 'Not saved: ' + e.message + ' Your text is back in the box.';
      }
    }
  } finally { inboxSending = false; LS.set('inboxQueue', inboxQueue); }
  renderInboxQueue();
  if ($('log-status')) {
    if (problem) $('log-status').textContent = problem;
    else if (sent) {
      $('log-status').textContent = 'Added to inbox.';
      setTimeout(() => { if ($('log-status').textContent === 'Added to inbox.') $('log-status').textContent = ''; }, 4000);
      if (!$('recent-logs').hidden) loadRecentLogs();
    }
  }
}

/* Tomorrow's plan: from 22:15 until the 00:40 rollover, check whether the nightly plan has been written. */
async function checkTomorrow() {
  const btn = $('tomorrow-ready');
  if (!btn || !Conn.paired()) return;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const evening = window.HQ_FORCE_EVENING || mins >= 22 * 60 + 15 || mins < T.rolloverMinutes;
  const working = londonWorkingDay(T.rolloverMinutes);
  const onToday = T.loadedDate === working && !T.manual;
  const tomorrow = shiftDay(working, 1);
  const saved = LS.get('cache.tomorrow', null);
  const ready = (r) => r && r.result && r.result.date === tomorrow && /^\s*•\s/m.test(String(r.result.notes || ''));
  btn.hidden = !(evening && onToday && ready(saved));
  if (!evening || !onToday || ready(saved) || (saved && saved.result && saved.result.date === tomorrow && Date.now() - saved.at < 10 * 60000)) return;
  try {
    const result = await dash('getDashboardDay', [tomorrow]);
    LS.set('cache.tomorrow', { at: Date.now(), result });
    btn.hidden = !(ready({ result }) && T.loadedDate === working && !T.manual);
  } catch (e) {}
}

/* ---------- bottom panels ---------- */
function showPanelLoading(panel, text) {
  const loading = document.createElement('span');
  loading.className = 'panel-loading';
  loading.textContent = text;
  panel.replaceChildren(loading);
}

/** Saved copy first (with a small "saved copy" line), then the fresh one from Google. */
async function panelLoad(fn, panelId, render, loadingText) {
  const panel = $(panelId);
  const request = (T.panelReq[fn] = (T.panelReq[fn] || 0) + 1);
  const saved = LS.get('cache.' + fn, null);
  const note = (text) => { const p = document.createElement('p'); p.className = 'panel-stamp'; p.textContent = text; panel.appendChild(p); };
  if (saved) { try { render(saved.result); note('Saved copy from ' + stampTime(saved.at) + ' · updating…'); } catch (e) { showPanelLoading(panel, loadingText); } }
  else showPanelLoading(panel, loadingText);
  try {
    const result = await dash(fn, []);
    if (request !== T.panelReq[fn]) return;
    render(result);
    LS.set('cache.' + fn, { at: Date.now(), result });
  } catch (e) {
    if (request !== T.panelReq[fn]) return;
    if (saved) { const old = panel.querySelector('.panel-stamp:last-child'); if (old) old.remove(); note('Couldn’t refresh (' + e.message + ') · saved copy from ' + stampTime(saved.at)); }
    else panel.textContent = 'Couldn’t load: ' + e.message;
  }
}

/* ---------- Ahead and Money pages ---------- */
function pageHead(name, title) {
  return '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' +
    '<button type="button" class="icon-btn" id="' + name + '-refresh" aria-label="Refresh">' + REFRESH_SVG + '</button>' +
    '<button type="button" class="icon-btn" id="' + name + '-settings" aria-label="Settings">' + GEAR + '</button></div></div>' +
    '<h1 class="page-title">' + title + '</h1>' +
    '<div id="' + name + '-pair" class="notice pair-prompt" hidden>Pair this icon once to see this page. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
    '<button type="button" class="log wide" id="' + name + '-pair-btn">Pair this icon</button></div>';
}
function pageEnter(name, title, panelId, after, load, stampKey) {
  const el = $(name + '-view');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = pageHead(name, title) + '<div id="' + panelId + '" aria-live="polite"></div>' + after;
    $(name + '-refresh').onclick = () => { T[stampKey] = Date.now(); load(); };
    $(name + '-settings').onclick = () => openSettings();
    $(name + '-pair-btn').onclick = () => openSettings('pair');
  }
  const paired = Conn.paired();
  $(name + '-pair').hidden = paired;
  $(panelId).hidden = !paired;
  if (paired && (!T[stampKey] || Date.now() - T[stampKey] > 120000)) { T[stampKey] = Date.now(); load(); }
}
function aheadEnter() { pageEnter('ahead', 'Ahead', 'next-days', '<section id="optional-week" class="optional-week" aria-live="polite"></section>', loadAhead, 'aheadAt'); }
function loadAhead() { loadNextFewDays(); loadOptionalWeek(); }

/* "Today" button: moves a Todoist task to today (recurring tasks are refused by the server). */
function todayButton(id, title) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'move-today'; b.textContent = 'Today';
  b.setAttribute('aria-label', 'Move ' + title + ' to today');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Moving…';
    try {
      await dash('moveTaskToToday', [id]);
      toast('Moved to today ✓');
      LS.del('cache.day'); T.lastLoad = 0;
      loadAhead();
    } catch (e) {
      b.disabled = false; b.textContent = 'Today';
      toast(/not a function/i.test(e.message) ? 'Needs the Optional-tasks file in the Life Dashboard script.' : e.message);
    }
  };
  return b;
}

function loadOptionalWeek() {
  const panel = $('optional-week');
  if (!panel) return;
  panelLoad('getOptionalTasks', 'optional-week', (result) => {
    panel.replaceChildren();
    const h = document.createElement('h3'); h.className = 'optional-title'; h.textContent = 'Optional'; panel.appendChild(h);
    const tasks = (result && result.tasks) || [];
    if (!tasks.length) { const p = document.createElement('p'); p.className = 'muted'; p.style.textAlign = 'center'; p.textContent = 'Nothing optional this week.'; panel.appendChild(p); return; }
    let last = null;
    tasks.forEach((t) => {
      const label = t.date ? t.label : 'Any time';
      if (label !== last) { const h4 = document.createElement('h4'); h4.textContent = label; panel.appendChild(h4); last = label; }
      const row = document.createElement('div'); row.className = 'ahead-row ahead-task ahead-no-time';
      const check = document.createElement('input'); check.type = 'checkbox'; check.setAttribute('aria-label', 'Complete ' + t.title);
      check.disabled = T.completing.has(t.id); check.checked = T.completing.has(t.id);
      check.onchange = () => { if (check.checked) completeTodoist(t.id, check, null, loadOptionalWeek); };
      const content = document.createElement('div');
      const a = document.createElement('a'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t.title; content.appendChild(a);
      const bits = [t.time, t.duration ? t.duration + ' min' : '', t.recurring ? 'repeats' : ''].filter(Boolean);
      if (bits.length) { const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = bits.join(' · '); content.appendChild(sub); }
      row.append(check, content);
      if (!t.recurring) row.appendChild(todayButton(t.id, t.title));
      panel.appendChild(row);
    });
  }, 'Loading optional tasks…');
}
function moneyEnter() { pageEnter('money', 'Money', 'money-panel', fileLinks([['Finances sheet', LINKS.moneySheet], ['Finances GPT', LINKS.moneyGpt]]), loadMoney, 'moneyAt'); }

function loadNextFewDays() {
  const panel = $('next-days');
  panelLoad('getNextFewDays', 'next-days', (result) => {
    panel.replaceChildren();
    [result.calendarError, result.tasksError].filter(Boolean).forEach((error) => {
      const w = document.createElement('p'); w.className = 'status'; w.textContent = error; panel.appendChild(w);
    });
    result.days.forEach((day) => {
      const block = document.createElement('section'); block.className = 'ahead-day';
      const heading = document.createElement('h3'); heading.textContent = day.label; block.appendChild(heading);
      const group = (label, items, calendar) => {
        if (!items.length) return;
        const title = document.createElement('h4'); title.textContent = label; block.appendChild(title);
        items.forEach((item) => {
          const row = document.createElement('div'); row.className = 'ahead-row';
          const time = document.createElement('span'); time.className = 'ahead-time'; time.textContent = item.time || '';
          const content = document.createElement('div');
          let name;
          if (!calendar) { name = document.createElement('a'); name.href = item.url; name.target = '_blank'; name.rel = 'noopener'; }
          else name = document.createElement('span');
          name.textContent = item.title;
          content.appendChild(name);
          if (calendar && item.location) { const place = document.createElement('div'); place.className = 'sub'; place.textContent = item.location; content.appendChild(place); }
          if (!calendar) {
            row.classList.add('ahead-task');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.setAttribute('aria-label', 'Complete ' + item.title);
            const id = item.id || decodeURIComponent(String(item.url || '').split('/').pop());
            check.disabled = T.completing.has(id); check.checked = T.completing.has(id);
            check.onchange = () => { if (check.checked) completeTodoist(id, check, null, loadNextFewDays); };
            row.appendChild(check);
          }
          if (calendar || item.time) row.append(time, content);
          else { row.classList.add('ahead-no-time'); row.appendChild(content); }
          if (!calendar) row.appendChild(todayButton(item.id || decodeURIComponent(String(item.url || '').split('/').pop()), item.title));
          block.appendChild(row);
        });
      };
      group('Calendar', day.calendar, true);
      group('Deadlines', day.deadlines, false);
      group('Dated tasks', day.tasks, false);
      if (!day.calendar.length && !day.deadlines.length && !day.tasks.length) {
        const empty = document.createElement('p'); empty.className = 'muted';
        empty.textContent = result.calendarError || result.tasksError ? 'No entries loaded for this day.' : 'Nothing recorded for this day.';
        block.appendChild(empty);
      }
      panel.appendChild(block);
    });
    const stamp = document.createElement('p'); stamp.className = 'panel-stamp'; stamp.textContent = 'Updated ' + result.updatedAt + ' · London time'; panel.appendChild(stamp);
  }, 'Loading the next few days…');
}

function loadMoney() {
  const panel = $('money-panel');
  panelLoad('getFinanceDashboard', 'money-panel', (result) => {
    panel.replaceChildren();
    const budgetBlock = (heading, metrics, error) => {
      const block = document.createElement('section'); block.className = 'money-budget';
      const h = document.createElement('h3'); h.textContent = heading; block.appendChild(h);
      if (error || !metrics || !metrics.spent) {
        const n = document.createElement('p'); n.className = 'budget-result'; n.textContent = error || 'Budget figures unavailable.'; block.appendChild(n);
      } else {
        const grid = document.createElement('div'); grid.className = 'budget-metrics';
        [['Spent this month', metrics.spent], ['Budget remaining', metrics.remaining], ['Pace', metrics.paceText]].forEach(([label, value]) => {
          const item = document.createElement('div');
          const caption = document.createElement('div'); caption.className = 'budget-metric-label'; caption.textContent = label;
          const text = document.createElement('p'); text.className = 'budget-result'; text.textContent = value;
          item.append(caption, text); grid.appendChild(item);
        });
        block.appendChild(grid);
      }
      panel.appendChild(block);
    };
    budgetBlock('Personal budget', result.budget, result.budgetError);
    budgetBlock('Equipment budget', result.equipment, result.equipmentError);
    const title = document.createElement('h3'); title.className = 'forecast-title'; title.textContent = 'Cash forecast'; panel.appendChild(title);
    if (result.forecastError) { const n = document.createElement('p'); n.textContent = result.forecastError; panel.appendChild(n); }
    else {
      const table = document.createElement('table'); table.className = 'money-table';
      const head = document.createElement('thead'), headRow = document.createElement('tr');
      ['Month', 'Expected\nIncome', 'Target', 'Above / below', 'Need to earn / week'].forEach((value) => {
        const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = value; headRow.appendChild(cell);
      });
      head.appendChild(headRow); table.appendChild(head);
      const body = document.createElement('tbody');
      result.months.forEach((month) => {
        const row = document.createElement('tr');
        [month.month, month.income, month.target || '—', null, month.perWeek].forEach((value, index) => {
          const cell = document.createElement('td');
          if (index === 3) {
            cell.textContent = month.gapAmount || '—';
            const label = document.createElement('span'); label.className = 'money-gap-label'; label.textContent = month.gapLabel || ''; cell.appendChild(label);
          } else cell.textContent = value;
          row.appendChild(cell);
        });
        body.appendChild(row);
      });
      table.appendChild(body);
      const wrap = document.createElement('div'); wrap.className = 'money-table-wrap'; wrap.appendChild(table); panel.appendChild(wrap);
    }
    const foot = document.createElement('div'); foot.className = 'money-footnotes';
    if (Number.isInteger(result.unreviewedThisMonth)) {
      const review = document.createElement('p'), link = document.createElement('a');
      link.textContent = result.unreviewedThisMonth + ' unreviewed transaction' + (result.unreviewedThisMonth === 1 ? '' : 's') + ' this month' + (result.flaggedThisMonth ? ' · ' + result.flaggedThisMonth + ' flagged' : '');
      link.href = result.transactionsUrl || 'https://docs.google.com/spreadsheets/d/1BTDWxXeNIoe106swS5elL95POGdvddpM-4BMJGzoLko/edit#gid=1901000002';
      link.target = '_blank'; link.rel = 'noopener'; review.appendChild(link); foot.appendChild(review);
    } else if (result.ledgerError) { const e = document.createElement('p'); e.textContent = result.ledgerError; foot.appendChild(e); }
    if (result.budget && result.budget.latestTransaction) {
      const fresh = document.createElement('p'); fresh.textContent = 'Latest recorded transaction: ' + result.budget.latestTransaction; foot.appendChild(fresh);
    }
    const updated = document.createElement('p'), source = document.createElement('a');
    source.textContent = 'Read from spreadsheet ' + result.updatedAt;
    source.href = result.sourceUrl || 'https://docs.google.com/spreadsheets/d/1BTDWxXeNIoe106swS5elL95POGdvddpM-4BMJGzoLko/edit#gid=1907100001';
    source.target = '_blank'; source.rel = 'noopener'; updated.appendChild(source); foot.appendChild(updated);
    panel.appendChild(foot);
  }, 'Loading money summary…');
}

const minuteTime = (value) => String(value || '').replace(/(\d{1,2}:\d{2}):\d{2}(?:\.\d+)?/g, '$1');

function loadRecentLogs() {
  const list = $('recent-logs');
  panelLoad('getRecentInboxLogs', 'recent-logs', (rows) => {
    list.replaceChildren();
    if (!rows || !rows.length) { list.textContent = 'No inbox entries yet.'; return; }
    const hasRoutes = rows.every((entry) => entry.destinations);
    const grid = document.createElement('div'); grid.className = 'logs-grid';
    const routes = [['health', '♥', 'Health'], ['finance', '£', 'Finances'], ['todoist', '', 'Todoist']];
    if (hasRoutes) {
      const head = document.createElement('div'); head.className = 'logs-header';
      const caption = document.createElement('span'); caption.textContent = 'Recent inbox entries'; head.appendChild(caption);
      routes.forEach(([key, icon, name]) => {
        const label = document.createElement('span'); label.className = 'route-heading'; label.title = name; label.setAttribute('aria-label', name);
        if (key === 'todoist') label.innerHTML = TODOIST_SVG; else label.textContent = icon;
        head.appendChild(label);
      });
      grid.appendChild(head);
    }
    rows.forEach((entry) => {
      const row = document.createElement('div'); row.className = hasRoutes ? 'log-entry' : 'log-entry-legacy';
      const meta = document.createElement('div'); meta.className = 'log-entry-meta';
      const time = document.createElement('span'); time.textContent = minuteTime(entry.timestamp);
      const status = document.createElement('span'); status.textContent = entry.processed ? 'Processed' : ('Not processed · ' + (entry.status || 'New'));
      const text = document.createElement('div'); text.className = 'log-entry-text'; text.textContent = entry.text;
      meta.append(time, status);
      const content = document.createElement('div'); content.className = 'log-entry-content'; content.append(meta, text); row.appendChild(content);
      const other = entry.destinations && entry.destinations.other;
      if (other && other.recorded && (other.labels || []).length) {
        const dest = document.createElement('div'); dest.className = 'log-other-destinations';
        dest.textContent = (other.verified ? '✓ ' : '○ ') + other.labels.join(', ') + (other.verified ? '' : ' · verification pending'); content.appendChild(dest);
      }
      if (hasRoutes) routes.forEach(([key, , name]) => {
        const dest = entry.destinations[key] || {};
        const mark = document.createElement(dest.recorded ? 'a' : 'span');
        mark.className = 'route-state' + (dest.verified ? ' verified' : dest.recorded ? ' recorded' : '');
        mark.textContent = dest.verified ? '✓' : dest.recorded ? '○' : '—';
        const label = name + ': ' + (dest.verified ? 'verified destination recorded' : dest.recorded ? 'recorded; verification pending' : 'no destination recorded');
        mark.title = label; mark.setAttribute('aria-label', label);
        if (dest.recorded) { mark.href = dest.url; mark.target = '_blank'; mark.rel = 'noopener'; }
        row.appendChild(mark);
      });
      grid.appendChild(row);
    });
    list.appendChild(grid);
    const note = document.createElement('p'); note.className = 'log-route-note';
    note.textContent = '✓ Verified destination · ○ Recorded, pending verification · — No transfer recorded'; list.appendChild(note);
  }, 'Loading…');
}

function loadExtras() {
  const list = $('medications');
  panelLoad('getDashboardExtras', 'medications', (res) => {
    list.replaceChildren();
    if (res.medicationError) { list.textContent = res.medicationError; return; }
    if (!res.medications.length) { list.textContent = 'No medication events in the feed.'; return; }
    res.medications.forEach((event) => {
      const row = document.createElement('div'); row.className = 'medication-row';
      const name = document.createElement('div'); name.className = 'medication-name'; name.textContent = event.medication;
      const time = document.createElement('div'); time.className = 'medication-time'; time.textContent = minuteTime(event.timestamp);
      row.append(name, time); list.appendChild(row);
    });
  }, 'Loading…');
}

/* ---------- celebration ---------- */
let completionAudio = null;
function prepareCompletionAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve();
    if (!completionAudio) completionAudio = new Ctx();
    return completionAudio.state === 'suspended' ? completionAudio.resume().catch(() => {}) : Promise.resolve();
  } catch (e) { return Promise.resolve(); }
}
/* Reward sounds: the original bell arpeggio plus a few cousins, never the same one twice in a row. */
const SOUNDS = [
  { name: 'bells', type: 'sine', echo: true, step: 0.065, notes: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093, 2637] },
  { name: 'bells', type: 'sine', echo: true, step: 0.065, notes: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093, 2637] },
  { name: 'pentatonic', type: 'triangle', echo: true, step: 0.055, notes: [587.33, 659.25, 783.99, 880, 1174.66, 1318.51, 1567.98, 1760] },
  { name: 'marimba', type: 'triangle', echo: false, step: 0.09, decay: 0.25, notes: [783.99, 659.25, 523.25, 783.99, 1046.5, 1567.98] },
  { name: 'bloom', type: 'sine', echo: true, step: 0.018, decay: 0.9, notes: [523.25, 659.25, 783.99, 987.77, 1318.51, 1975.53] },
  { name: 'glass', type: 'sine', echo: true, step: 0.16, decay: 0.7, harmonics: true, notes: [1318.51, 1975.53, 2637] },
  { name: 'tumble', type: 'sine', echo: true, step: 0.06, notes: [2093, 1567.98, 1318.51, 1046.5, 1318.51, 1567.98, 2093, 2637] }
];
let lastSound = -1;
function completionPop() {
  if (!completionAudio || completionAudio.state !== 'running') return;
  try {
    let pick;
    do { pick = Math.floor(Math.random() * SOUNDS.length); } while (SOUNDS.length > 1 && SOUNDS[pick].name === (SOUNDS[lastSound] || {}).name);
    lastSound = pick;
    const sound = SOUNDS[pick];
    const audio = completionAudio;
    const start = audio.currentTime + 0.015;
    const decay = sound.decay || 0.48;
    sound.notes.forEach((frequency, index) => {
      const time = start + index * sound.step;
      const layers = sound.harmonics ? [[1, 1], [2.76, 0.25], [5.4, 0.08]] : [[1, 1]];
      (sound.echo ? [0, 0.12] : [0]).forEach((echo, repeat) => {
        layers.forEach(([mult, level]) => {
          const osc = audio.createOscillator(), gain = audio.createGain();
          osc.type = sound.type;
          osc.frequency.setValueAtTime(frequency * mult, time + echo);
          gain.gain.setValueAtTime(0.0001, time + echo);
          gain.gain.exponentialRampToValueAtTime((repeat ? 0.022 : 0.105) * level, time + echo + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + echo + decay);
          osc.connect(gain); gain.connect(audio.destination);
          osc.onended = () => { osc.disconnect(); gain.disconnect(); };
          osc.start(time + echo); osc.stop(time + echo + decay + 0.02);
        });
      });
    });
  } catch (e) {}
}
const CELEBRATION = { figures: ['Dean Gaffney', 'Les Dennis', 'Rustie Lee', 'Cheryl Baker', 'Timmy Mallett', 'Pat Sharp', 'Christopher Biggins', 'Su Pollard', 'Keith Chegwin', 'Chico Slimani', 'Paul Chuckle', 'Michelle McManus', 'Cecilia Payne-Gaposchkin', 'Satyendra Nath Bose', 'Emmy Noether', 'Lise Meitner', 'George Green', 'Oliver Heaviside', 'Caroline Herschel', 'Wendy Cope', 'Ivor Cutler', 'Stevie Smith', 'Edith Sitwell', 'Hilaire Belloc', 'Nina Blenkinsop, first woman to sharpen a pencil in an imaginary Russia', 'Dr Clive Widdershins, visiting professor of almost', 'Maureen Crumb, deputy inventor of Thursday', 'Yuri Spatula, runner-up in the 1974 indoor horizon trials', 'Doreen Puddle, poet laureate of a lay-by', 'Professor Len Fidget, discoverer of the third elbow', 'Valentina Plonk, honorary custodian of the spare moon', 'Gareth Bunting, regional semaphore understudy', 'Dr Enid Biscuit, chair of applied hesitation', 'Ronald Sprocket, Britain\'s seventh-most promising cloud', 'Beryl Quince, first person to alphabetise a fog'],
  openings: ['Let x be courage', 'If hope equals soup', 'Assume a spherical biscuit', 'Let doubt approach zero', 'When effort meets a duck', 'If destiny wears slippers', 'Let triumph be triangular', 'Given one heroic wobble'],
  middles: ['multiply by jazz', 'divide doubt by toast', 'carry the imaginary pigeon', 'subtract the spare Tuesday', 'factorise your trousers', 'differentiate the teapot', 'square the tiny victory', 'solve for mild thunder'],
  endings: ['and proceed diagonally.', 'QED, darling.', 'the crumpet is yours.', 'hence, magnificent.', 'and call it progress.', 'the ducks approve.', 'therefore, onwards.', 'one less thing.'] };
let lastRewardFigure = '';
function closeReward() { $('reward').hidden = true; $('reward').replaceChildren(); }
document.addEventListener('click', (event) => {
  const reward = $('reward');
  if (!reward.hidden && !reward.contains(event.target) && !(event.target.id === 'test-celebration')) {
    event.preventDefault(); event.stopImmediatePropagation(); closeReward();
  }
}, true);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('reward').hidden) closeReward(); });
function celebrateCompletion() {
  completionPop();
  const pick = (values) => values[Math.floor(Math.random() * values.length)];
  const available = CELEBRATION.figures.filter((n) => n !== lastRewardFigure);
  const figure = pick(available.length ? available : CELEBRATION.figures);
  lastRewardFigure = figure;
  const reward = $('reward');
  reward.replaceChildren();
  const card = document.createElement('div'); card.className = 'reward-card';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'reward-close'; close.setAttribute('aria-label', 'Close celebration'); close.textContent = '×';
  close.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeReward(); };
  const mark = document.createElement('span'); mark.className = 'reward-mark'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('div'); caption.className = 'reward-caption';
  caption.textContent = '“' + pick(CELEBRATION.openings) + ', ' + pick(CELEBRATION.middles) + ', ' + pick(CELEBRATION.endings) + '”';
  const attribution = document.createElement('div'); attribution.className = 'reward-attribution'; attribution.textContent = '— ' + figure;
  card.append(close, mark, caption, attribution);
  reward.appendChild(card);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < 8; i++) {
      const spark = document.createElement('span'); spark.className = 'reward-spark'; spark.textContent = i % 2 ? '✦' : '·'; spark.setAttribute('aria-hidden', 'true');
      const angle = (i / 8) * Math.PI * 2;
      spark.style.setProperty('--x', Math.cos(angle) * 125 + 'px');
      spark.style.setProperty('--y', Math.sin(angle) * 95 + 'px');
      spark.style.setProperty('--r', i * 45 + 'deg');
      reward.appendChild(spark);
    }
  }
  reward.hidden = false;
}

/* ================= TRENDS view =================
   Symptom history from Health tracker › Events, via the receiver's "config" answer (HealthLog v6).
   Each health day (04:00 to 04:00) has the highest pain, stiffness, fatigue, brain fog and headache
   score logged that day; the day's colour is the average of those highs. Read-only. */
const TREND_SYMS = [
  { k: 'p', name: 'Pain', color: '#2a78d6', dash: '' },
  { k: 's', name: 'Stiffness', color: '#1baf7a', dash: '6 3' },
  { k: 'f', name: 'Fatigue', color: '#d99200', dash: '2 3' },
  { k: 'g', name: 'Brain fog', color: '#7a68e0', dash: '8 3 2 3' },
  { k: 'h', name: 'Headache', color: '#e0679a', dash: '1 4' }
];
const FLARE_AT = 7;
const TR = { at: 0, loading: false, sel: null, on: LS.get('trends.on', ['load']) };
const TRENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16h16"/><path d="m7.5 14.5 3.5-4 3 2.5 5-6"/></svg>';

function trendsEnter() {
  const el = $('trends-view');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' +
      '<button type="button" class="icon-btn" id="trends-refresh" aria-label="Refresh">' + REFRESH_SVG + '</button>' +
      '<button type="button" class="icon-btn" id="trends-settings" aria-label="Settings">' + GEAR + '</button></div></div>' +
      '<h1 class="page-title">Trends</h1><div id="trends-body" aria-live="polite"></div>';
    $('trends-refresh').onclick = () => trendsLoad();
    $('trends-settings').onclick = () => openSettings();
    el.addEventListener('click', trendsClick);
  }
  trendsRender();
  if (Conn.canLog() && (!TR.at || Date.now() - TR.at > 120000)) trendsLoad();
}

async function trendsLoad() {
  if (TR.loading || !Conn.canLog()) return;
  TR.loading = true; TR.at = Date.now(); trendsRender();
  try { await logRefreshConfig(); } finally { TR.loading = false; trendsRender(); }
}

function trendsDays() {
  const sy = cfg.symptoms;
  if (!sy || !Array.isArray(sy.days) || !sy.startKey) return null;
  const list = sy.days.map((d, i) => {
    const have = TREND_SYMS.filter((x) => typeof d[x.k] === 'number');
    const load = have.length ? have.reduce((a, x) => a + d[x.k], 0) / have.length : null;
    return { key: addDays(sy.startKey, i), d, load, scores: have.length, flare: load !== null && load >= FLARE_AT };
  });
  const by = {};
  list.forEach((x) => { by[x.key] = x; });
  return { list, by, today: sy.todayKey || list[list.length - 1].key, marks: Array.isArray(sy.marks) ? sy.marks : [] };
}

const heatLevel = (l) => (l < 4.5 ? 0 : l < 5.5 ? 1 : l < 6.2 ? 2 : l < 7 ? 3 : 4);
const shortDate = (k) => keyToDate(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const longDate = (k) => keyToDate(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const avgLoad = (xs) => { const v = xs.filter((x) => x.load !== null); return v.length ? v.reduce((a, x) => a + x.load, 0) / v.length : null; };

function trendsRender() {
  const body = $('trends-body');
  if (!body) return;
  const T2 = trendsDays();
  if (!T2) {
    if (!Conn.canLog()) body.innerHTML = '<div class="notice">Pair this icon once to see your trends.<button type="button" class="log wide" data-tr="pair">Pair this icon</button></div>';
    else if (TR.loading) body.innerHTML = '<p class="small tr-center">Loading your check-ins…</p>';
    else body.innerHTML = '<div class="notice">Trends needs the receiver update (HealthLog v6). Once it’s deployed, this page fills in by itself.</div>';
    return;
  }
  const { list, by, today } = T2;
  const last = (n, end) => list.filter((x) => x.key <= addDays(today, -end) && x.key > addDays(today, -end - n));
  const flares = last(28, 0).filter((x) => x.flare).length;
  const wk = avgLoad(last(7, 0)), prev = avgLoad(last(7, 7));
  let worst = '', worstV = -1;
  TREND_SYMS.forEach((s) => {
    const v = last(7, 0).filter((x) => typeof x.d[s.k] === 'number');
    if (!v.length) return;
    const m = v.reduce((a, x) => a + x.d[s.k], 0) / v.length;
    if (m > worstV) { worstV = m; worst = s.name; }
  });
  const delta = wk !== null && prev !== null ? wk - prev : null;
  let html = '<div class="tr-stats">' +
    '<div class="tr-stat"><span>Flare days</span><b>' + flares + '</b><small>last 4 weeks</small></div>' +
    '<div class="tr-stat"><span>This week</span><b>' + (wk === null ? '–' : wk.toFixed(1)) + '</b>' +
      (delta === null ? '' : '<small>' + (Math.abs(delta) < 0.05 ? 'same as' : (delta < 0 ? '↓ ' : '↑ ') + Math.abs(delta).toFixed(1) + ' vs') + ' last week</small>') + '</div>' +
    '<div class="tr-stat"><span>Highest lately</span><b class="tr-word">' + esc(worst || '–') + '</b>' + (worst ? '<small>avg ' + worstV.toFixed(1) + ' this week</small>' : '') + '</div></div>';

  // Calendar: six Monday-start weeks ending with this week.
  const end = addDays(today, 6 - ((keyToDate(today).getDay() + 6) % 7));
  const start = addDays(end, -41);
  html += '<div class="tr-cal" role="grid" aria-label="Symptom calendar, last six weeks">' +
    ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'].map((t) => '<span class="tr-dh">' + t + '</span>').join('');
  for (let w = 0; w < 6; w++) {
    const ws = addDays(start, w * 7);
    html += '<span class="tr-wk">' + esc(shortDate(ws)) + '</span>';
    for (let i = 0; i < 7; i++) {
      const k = addDays(ws, i), x = by[k], n = keyToDate(k).getDate();
      const cls = ['tr-cell'];
      if (k === today) cls.push('today');
      if (k === TR.sel) cls.push('sel');
      if (k > today) { html += '<span class="tr-cell future"></span>'; continue; }
      if (x && x.load !== null) {
        cls.push('h' + heatLevel(x.load));
        html += '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + ', average ' + x.load.toFixed(1) + (x.flare ? ', flare' : '') + '">' +
          n + (x.flare ? '<i class="tr-flare"></i>' : '') + '</button>';
      } else {
        cls.push('empty');
        html += '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + ', no check-in">' + n + '</button>';
      }
    }
  }
  html += '</div><div class="tr-key"><span>Lighter</span><span class="tr-ramp"><i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i></span><span>Heavier</span>' +
    '<span><i class="tr-flare inline"></i>Flare</span><span><i class="tr-nodata"></i>No check-in</span></div>';

  // Detail line for the chosen day.
  const sel = TR.sel && TR.sel <= today ? TR.sel : null;
  if (sel) {
    const x = by[sel];
    html += '<p class="tr-detail"><b>' + esc(longDate(sel)) + '</b> · ' + (x && x.load !== null
      ? 'average ' + x.load.toFixed(1) + (x.flare ? ' · flare' : '') + ' · ' + TREND_SYMS.filter((s) => typeof x.d[s.k] === 'number').map((s) => s.name.toLowerCase() + ' ' + x.d[s.k]).join(', ') + (x.scores < 3 ? ' · only ' + x.scores + ' of 5 scored' : '')
      : (sel === today ? 'no check-in yet today' : 'no check-in logged')) + '</p>';
  } else html += '<p class="tr-detail muted">Tap a day for its highest scores.</p>';

  // Chart chips + chart.
  const series = [{ k: 'load', name: 'Overall' }].concat(TREND_SYMS);
  html += '<div class="tr-chips">' + series.map((s) => '<button type="button" class="tr-chip" data-tr="series" data-v="' + s.k + '" aria-pressed="' + TR.on.includes(s.k) + '">' +
    '<i style="' + (s.k === 'load' ? 'background:var(--ink)' : 'background:' + s.color) + '"></i>' + esc(s.name) + '</button>').join('') + '</div>';
  html += trendsChart(T2);
  html += '<p class="tr-foot">Each day shows the highest score you logged for each symptom; the colour is their average. A flare is an average of ' + FLARE_AT + ' or more. Days run 04:00 to 04:00.</p>' +
    fileLinks([['Health tracker', LINKS.healthSheet]]);
  body.innerHTML = html;
}

function trendsChart(T2) {
  const { marks } = T2;
  // Start the chart at the first logged day (at least the last 14 days) so empty weeks don't squash it.
  const firstData = T2.list.findIndex((x) => x.load !== null);
  const list = T2.list.slice(Math.max(0, Math.min(firstData < 0 ? 0 : firstData, T2.list.length - 14)));
  const W = 360, H = 190, L = 22, R = 8, TOP = 16, B = 22;
  const n = list.length, cw = W - L - R, ch = H - TOP - B;
  const X = (i) => L + (n > 1 ? (i * cw) / (n - 1) : 0);
  const Y = (v) => TOP + ch - (v / 10) * ch;
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily symptom scores over the last six weeks">';
  for (let v = 0; v <= 10; v += 2) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="tr-grid"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5) + '" class="tr-ax" text-anchor="end">' + v + '</text>';
  list.forEach((x, i) => { if ((n - 1 - i) % 7 === 0 && (i > 2 || i === n - 1)) svg += '<text x="' + X(i) + '" y="' + (H - 6) + '" class="tr-ax" text-anchor="' + (i === n - 1 ? 'end' : 'middle') + '">' + esc(shortDate(x.key)) + '</text>'; });
  marks.forEach((m) => {
    const i = list.findIndex((x) => x.key === m.key);
    if (i < 0) return;
    const right = X(i) > W * 0.55;
    svg += '<line x1="' + X(i) + '" x2="' + X(i) + '" y1="' + TOP + '" y2="' + (TOP + ch) + '" class="tr-mark"/><text x="' + (X(i) + (right ? -3 : 3)) + '" y="' + (TOP - 4) + '" class="tr-ax" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(m.label) + ' starts</text>';
  });
  const path = (get) => {
    let d = '', pen = false;
    list.forEach((x, i) => {
      const v = get(x);
      if (typeof v !== 'number') { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      pen = true;
    });
    return d;
  };
  const dots = (get, cls) => list.map((x, i) => { const v = get(x); return typeof v === 'number' && (i === 0 || typeof get(list[i - 1]) !== 'number') && (i === n - 1 || typeof get(list[i + 1]) !== 'number') ? '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="2" class="' + cls + '"/>' : ''; }).join('');
  TREND_SYMS.forEach((s) => {
    if (!TR.on.includes(s.k)) return;
    const get = (x) => x.d[s.k];
    svg += '<path d="' + path(get) + '" fill="none" stroke="' + s.color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>' +
      dots(get, '').replace(/class=""/g, 'fill="' + s.color + '"');
  });
  if (TR.on.includes('load')) {
    const get = (x) => x.load;
    svg += '<path d="' + path(get) + '" fill="none" class="tr-load"/>' + dots(get, 'tr-loaddot');
    list.forEach((x, i) => { if (x.flare) svg += '<circle cx="' + X(i) + '" cy="' + Y(x.load) + '" r="3.6" class="tr-flaredot"/>'; });
  }
  return svg + '</svg>';
}

function trendsClick(ev) {
  const el = ev.target.closest('[data-tr]');
  if (!el) return;
  const act = el.dataset.tr, v = el.dataset.v;
  if (act === 'day') { TR.sel = TR.sel === v ? null : v; trendsRender(); }
  else if (act === 'series') {
    TR.on = TR.on.includes(v) ? TR.on.filter((x) => x !== v) : TR.on.concat(v);
    if (!TR.on.length) TR.on = ['load'];
    LS.set('trends.on', TR.on); trendsRender();
  }
  else if (act === 'pair') openSettings('pair');
}

/* ================= wiring ================= */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  if (el.closest('#log-view')) logAct(el);
  else if (el.closest('#settings-view')) settingsAct(el);
});
document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'pair-form') { ev.preventDefault(); pairSubmit(); }
});

window.addEventListener('online', () => { logFlush(); inboxFlush(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  logFlush();
  if (view === 'log') { logRender(); logRefreshConfig(); }
  inboxFlush();
  if ((view === 'ahead' || view === 'money') && Conn.paired()) showView(view);
  if (view === 'trends') trendsEnter();
  if (view === 'today' && Conn.paired()) {
    if (T.loadedDate && !T.manual && londonWorkingDay(T.rolloverMinutes) !== T.loadedDate) { T.choice = null; loadDay(true); }
    else if (Date.now() - T.lastLoad > 120000) loadDay(false);
  }
});
setInterval(() => {
  if (document.hidden) return;
  if (view === 'log' && !S.timeOpen && !S.open && document.activeElement.tagName !== 'INPUT') logRender();
  if (queue.length) logFlush();
}, 60000);

showView(START);
if (Conn.canLog()) { logFlush(); logRefreshConfig(); }

if ('serviceWorker' in navigator) {
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    const busy = Object.keys(pending).length || inboxSending || T.completing.size || (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));
    if (!busy) location.reload();
  });
  navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
