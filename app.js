/* Life HQ phone app: Today (dashboard) and Health log in one page.
   Each Home Screen icon opens on its own tab and is paired separately (iPhone keeps
   each icon's storage apart). Talks only to the Ru - Inbox Receiver script. */
'use strict';
/* Older browsers (e.g. e-ink tablets with an old built-in WebView) lack a few newer functions. */
if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren = function () { while (this.firstChild) this.removeChild(this.firstChild); this.append.apply(this, arguments); };
if (!DocumentFragment.prototype.replaceChildren) DocumentFragment.prototype.replaceChildren = Element.prototype.replaceChildren;
if (!Object.fromEntries) Object.fromEntries = (it) => { const o = {}; for (const [k, v] of it) o[k] = v; return o; };
if (!String.prototype.replaceAll) String.prototype.replaceAll = function (a, b) { return this.split(a).join(b); };
const APP_VERSION = 'v24 · 29 Oct';
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

/* Refresh buttons spin while their load runs (at least 600 ms so a quick load still shows). */
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function spin(btn, work) {
  if (!btn || btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true'); btn.classList.add('busy');
  try { await Promise.all([Promise.resolve().then(work).catch(() => {}), sleepMs(600)]); }
  finally { btn.removeAttribute('aria-busy'); btn.classList.remove('busy'); }
}

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
  if (!Conn.paired()) throw new Error('This device isn’t paired yet.');
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
  toast('This device was unpaired. Pair it again in Settings.');
  showView(view === 'settings' ? 'settings' : view);
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Phone';
  const standalone = (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  return kind + ' · Life HQ' + (standalone ? '' : ' (browser)');
}

/* ================= views ================= */
/* Tabs on this device (Settings): e.g. only Today and Ahead on the e-ink tablet. Hidden tabs never load. */
const ALL_TABS = [['today', 'Today'], ['ahead', 'Ahead'], ['money', 'Money'], ['trends', 'Health'], ['log', 'Log']];
const tabsOn = () => { const t = LS.get('tabs', null); const ok = Array.isArray(t) ? t.filter((x) => ALL_TABS.some(([k]) => k === x)) : []; return ok.length ? ok : ALL_TABS.map(([k]) => k); };
const tabOn = (v) => tabsOn().includes(v);
function applyTabs() { document.querySelectorAll('#tabbar [data-tab]').forEach((b) => { b.hidden = !tabOn(b.dataset.tab); }); }
let view = null, lastMainView = tabOn(START) ? START : tabsOn()[0];
function showView(v) {
  if (v !== 'settings' && !tabOn(v)) v = tabsOn()[0];
  view = v;
  // Pop-ups belong to their page: close them when moving to another tab.
  if (v !== 'log') S.sheet = null;
  if (v !== 'trends') TR.pop = null;
  document.body.classList.remove('sheet-open');
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
$('toast-btn').addEventListener('click', () => {
  const id = $('toast-btn').dataset.v;
  if (id && id.indexOf('task:') === 0) { const p = pendingDone[id.slice(5)]; if (p) p.undo(); $('toast').hidden = true; }
  else if (id) logUndo(id);
});
/* Text with web links made clickable (tasks): plain text nodes, so nothing is treated as HTML. */
function linkified(text) {
  const frag = document.createDocumentFragment();
  String(text || '').split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g).forEach((part, i) => {
    if (i % 2) { const a = document.createElement('a'); a.href = part; a.target = '_blank'; a.rel = 'noopener'; a.className = 'inline-link'; a.textContent = part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48) + (part.length > 56 ? '…' : ''); frag.appendChild(a); }
    else if (part) frag.appendChild(document.createTextNode(part));
  });
  return frag;
}

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ================= settings + pairing ================= */
let settingsMode = 'settings', unpairArmed = false, devices = null, devicesError = '';

function settingsRender() {
  const el = $('settings-view');
  if (settingsMode === 'pair') { el.innerHTML = pairMarkup(); return; }
  const t = themePref();
  const dev = LS.get('device', null);
  const state = Conn.paired()
    ? 'Paired as <b>' + esc(dev && dev.name ? dev.name : 'this device') + '</b>.'
    : Conn.key() ? 'Health log is using the older shared key. Pair this device to switch on Today and drop the key from it.'
      : 'Not paired yet.';
  el.innerHTML =
    '<header><h1>Settings</h1><button type="button" class="log" data-act="done">Done</button></header>' +
    '<h2>APPEARANCE</h2><div class="grid3" role="group" aria-label="Appearance">' +
      [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match device']].map(([v, l]) =>
        '<button type="button" class="seg" data-act="theme" data-v="' + v + '" aria-pressed="' + (t === v) + '">' + l + '</button>').join('') + '</div>' +
    '<h2>TABS ON THIS DEVICE</h2><div class="chips" role="group" aria-label="Tabs on this device">' + ALL_TABS.map(([k, l]) =>
      '<button type="button" class="chip" data-act="tab-toggle" data-v="' + k + '" aria-pressed="' + tabOn(k) + '"><b>' + l + '</b></button>').join('') + '</div>' +
      '<p class="small">Hidden tabs don’t load at all, so a slow device (like the e-ink tablet) stays quick. Only this device changes.</p>' +
    '<h2>THIS DEVICE</h2><div class="notice">' + state +
      '<div class="row2" style="margin-top:10px"><button type="button" class="seg" data-act="pair-open">' + (Conn.paired() ? 'Pair again' : 'Pair this device') + '</button>' +
      (Conn.paired() ? '<button type="button" class="seg" data-act="unpair">' + (unpairArmed ? 'Tap again to unpair' : 'Unpair') + '</button>' : '') + '</div></div>' +
    (Conn.paired() ? '<h2>PAIRED DEVICES</h2>' + devicesMarkup() : '') +
    '<h2>OTHER FILES</h2>' + fileLinks([['Works &amp; Royalties', LINKS.works], ['Inventory', LINKS.inventory], ['Life HQ sheet', LINKS.hqSheet]]) +
    '<h2>ABOUT</h2><p class="small">Life HQ app ' + esc(APP_VERSION) + '. Each device is paired on its own. Pages show saved copies instantly, then refresh. Health records go straight to your health tracker.</p>' +
    '<div class="row2"><button type="button" class="seg" data-act="update">Check for update</button><button type="button" class="seg" id="test-celebration" data-act="celebrate">Test celebration</button></div>';
  if (Conn.paired() && devices === null && !devicesError) loadDevices();
}

function devicesMarkup() {
  if (devicesError) return '<p class="small">' + esc(devicesError) + '</p>';
  if (!devices) return '<p class="small">Loading…</p>';
  const me = (LS.get('device', null) || {}).id;
  return devices.map((d) => '<div class="dev"><span>' + esc(d.name) + '<small>' + (d.id === me ? 'This device · ' : '') + 'last used ' + esc(d.lastUsed || '–') + '</small></span>' +
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
  return '<header><h1>Pair this device</h1><button type="button" class="seg" data-act="pair-cancel" style="padding:0 14px">Cancel</button></header>' +
    '<form id="pair-form" class="stack">' +
    '<p>On your Mac: open the <b>Ru - Inbox Receiver</b> script, choose <b>pairNewDevice</b> in the function menu and press <b>Run</b>. Copy the line starting <b>HQ1.</b> from the log and paste it here.</p>' +
    '<p class="small">A code works for 15 minutes, for up to two devices. Each device needs pairing once.</p>' +
    '<label for="pair-code">Setup code</label>' +
    '<input id="pair-code" class="text-input code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="HQ1.…">' +
    (navigator.clipboard && navigator.clipboard.readText ? '<button type="button" class="seg" data-act="paste">Paste</button>' : '') +
    '<label for="pair-name">Name for this device</label>' +
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
  else if (act === 'tab-toggle') {
    const on = tabsOn();
    const next = on.includes(v) ? on.filter((x) => x !== v) : ALL_TABS.map(([k]) => k).filter((k) => on.includes(k) || k === v);
    if (!next.length) { toast('Keep at least one tab.'); return; }
    LS.set('tabs', next); applyTabs(); if (!next.includes(lastMainView)) lastMainView = next[0]; settingsRender();
  }
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
    { name: 'Probiotic', strength: '70 ml', perDay: 1 }],
  foods: ['Green apple', 'Dark chocolate', 'Cashews', 'Onigiri', 'Samosa', 'Coffee with oat milk', 'Chai with oat milk'],
  trial: null, today: { meds: {}, wakeAt: '', lastCheckin: '' }
};
const SCALES = [['pain', 'Pain'], ['stiff', 'Stiffness'], ['fatigue', 'Fatigue'], ['clarity', 'Mental clarity'], ['headache', 'Headache'],
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

/* Wake check-ins come in two stages: in bed (Period Wake) and getting up (Period Getting up). */
const wokeToday = () => !!(cfg.today && cfg.today.wakeAt) || recent.some((r) => r.hday === healthKey(new Date()) && r.wake && r.status !== 'failed');
const upToday = () => !!(cfg.today && cfg.today.upAt) || recent.some((r) => r.hday === healthKey(new Date()) && r.up && r.status !== 'failed');
function guessPeriod() {
  const now = new Date(), h = now.getHours(), mins = h * 60 + now.getMinutes();
  if (mins >= 23 * 60 + 30 || h < 4) return 'Bed';
  if (h < 14 && !upToday()) return 'Wake';
  return 'Day';
}
const guessStage = () => (wokeToday() ? 'up' : 'bed');

const S = {
  open: false, period: null, stage: null, scores: {}, checkNote: '', calMed: null, moment: null, momentNote: '',
  bristol: null, size: null, urgent: false, bowelNote: '',
  meds: [], doses: {}, food: '', time: null, timeOpen: false,
  sheet: null, sheetFresh: false, refreshing: false, inboxText: '', inboxStatus: '', dirty: false,
  sleepT: { bed: '', wake: '', up: '' },
  actText: '', actType: null, actMin: null, actEffort: null
};
const ACT_TYPES = ['Walk', 'Dance', 'Aerial', 'Cycle', 'Carrying/lifting', 'Other'];
const ACT_MINS = [10, 20, 30, 45, 60, 90, 120];
const ACT_EFFORT = ['Easy', 'Moderate', 'Hard'];

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
  const tk = healthKey(new Date());
  const steps = planSteps();
  const cur = steps.find((x) => x.from <= tk && (!x.to || x.to >= tk));
  const next = steps.find((x) => x.from > tk);
  if ((!t || !t.name) && !cur) return '';
  if (!t || !t.name) {
    const d = dayNum(cur.from, tk), len = cur.to ? dayNum(cur.from, cur.to) : 0;
    return '<section class="trial tappable" data-act="plan-open" role="button" tabindex="0" aria-label="Medication plan">' +
      '<div class="trial-top"><span>CURRENT STEP</span>' + (cur.to ? '<span>ends ' + esc(shortDate(cur.to)) + '</span>' : '') + '</div>' +
      '<div class="trial-name">' + esc(cur.label) + ' · day ' + d + (len ? ' of ' + len : '') + '</div>' +
      '</section>';
  }
  const now = new Date();
  const today = dayKey(now);
  const localDone = recent.find((r) => r.day === today && r.kind === 'trial' && r.status !== 'failed');
  const doneAt = t.buttonDoneAt || (localDone ? localDone.hm : '');
  const woke = cfg.today.wakeAt || recent.some((r) => r.day === today && r.wake && r.status !== 'failed');
  const inWindow = hm(now) >= (t.from || '00:00') && hm(now) <= (t.until || '23:59');
  const showBtn = t.button && !doneAt && inWindow && (!t.needsWake || woke);
  return '<section class="trial' + (steps.length ? ' tappable" data-act="plan-open" role="button" tabindex="0' : '') + '" aria-label="Current trial">' +
    '<div class="trial-top"><span>CURRENT TRIAL</span>' + (t.ends ? '<span>ends ' + esc(t.ends) + '</span>' : '') + '</div>' +
    '<div class="trial-name">' + esc(t.name) + (t.day ? ' · day ' + esc(t.day) + (t.length ? ' of ' + esc(t.length) : '') : '') + '</div>' +
    (t.focus ? '<div class="trial-focus">Focus: ' + esc(t.focus) + '</div>' : '') +
    (showBtn ? '<button type="button" class="trial-btn" data-act="trial">' + esc(t.button) + '</button>' : '') +
    (doneAt && t.button ? '<div class="trial-today">' + esc(t.button.replace(/ now$/i, '')) + ' at ' + esc(doneAt) + ' · logged</div>' : '') +
    '</section>';
}

/* ---------- Medication plan (Meds → PLAN, via HealthLog v13) ---------- */
const planSteps = () => (cfg.plan && Array.isArray(cfg.plan.steps) ? cfg.plan.steps : []);
const dayNum = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000) + 1;
function stepState(st, today) {
  if (st.to && st.to < today) return 'done';
  if (st.from <= today && (!st.to || st.to >= today)) return 'now';
  return /propos/i.test(st.status || '') ? 'proposed' : 'next';
}
/* The days a step is judged on: its last 7 days when it runs 10+ days (the days before are "settling":
   the body is still adjusting to the change before it); otherwise the whole step. */
function stepWindow(st, today) {
  const end0 = st.to && st.to < today ? st.to : today;
  if (end0 < st.from) return null;
  const len = st.to ? dayNum(st.from, st.to) : dayNum(st.from, end0);
  const settle = len >= 10 ? len - 7 : 0;
  const winStart = settle ? addDays(st.from, settle) : st.from;
  return { start: winStart > end0 ? null : winStart, end: end0, settleEnd: settle ? addDays(st.from, settle - 1) : null, len };
}
function planHtml(today, withCompare) {
  const steps = planSteps();
  if (!steps.length) return '<p class="small">No plan found. It comes from the health tracker’s Meds tab (PLAN), via the receiver update HealthLog v13.</p>';
  const lastEnd = steps.reduce((m, x) => (x.to && x.to > m ? x.to : m), steps[0].from);
  const end = addDays(steps.some((x) => !x.to) ? addDays(lastEnd, 14) : lastEnd, 1);
  const start = steps[0].from;
  const span = dayNum(start, end);
  const W = 360, L = 4, R = 4, rowH = 28, top = 6, H = top + steps.length * rowH + 16;
  const X = (k) => L + ((dayNum(start, k) - 1) / span) * (W - L - R);
  let svg = '<svg class="tr-chart plan-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Medication plan timeline">' +
    '<defs><pattern id="plan-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="plan-hatch-bg"/><line x1="0" y1="0" x2="0" y2="4" class="plan-hatch-line"/></pattern></defs>';
  // month ticks
  let m = keyToDate(start); m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  while (dayKey(m) < end) { const k = dayKey(m); svg += '<line x1="' + X(k).toFixed(1) + '" x2="' + X(k).toFixed(1) + '" y1="2" y2="' + (H - 12) + '" class="tr-bedline"/><text x="' + (X(k) + 2).toFixed(1) + '" y="' + (H - 2) + '" class="tr-ax">' + esc(m.toLocaleDateString('en-GB', { month: 'short' })) + '</text>'; m = new Date(m.getFullYear(), m.getMonth() + 1, 1); }
  steps.forEach((st, i) => {
    const y = top + i * rowH, state = stepState(st, today);
    const to = st.to || addDays(lastEnd, 14);
    const x1 = X(st.from), x2 = Math.max(x1 + 3, X(addDays(to, 1)));
    const w = stepWindow(st, today) || (st.to && dayNum(st.from, st.to) >= 10 ? { settleEnd: addDays(st.from, dayNum(st.from, st.to) - 8) } : {});
    svg += '<text x="' + Math.min(x1, W - 150).toFixed(1) + '" y="' + (y + 9) + '" class="tr-ax plan-lab">' + esc(st.label) + '</text>';
    svg += '<rect x="' + x1.toFixed(1) + '" y="' + (y + 12) + '" width="' + (x2 - x1).toFixed(1) + '" height="10" rx="3" class="plan-bar ' + state + (st.to ? '' : ' open') + '"/>';
    if (w.settleEnd && st.to) svg += '<rect x="' + x1.toFixed(1) + '" y="' + (y + 12) + '" width="' + Math.max(0, X(addDays(w.settleEnd, 1)) - x1).toFixed(1) + '" height="10" rx="3" class="plan-settle"/>';
    svg += '<rect x="' + x1.toFixed(1) + '" y="' + y + '" width="' + (x2 - x1).toFixed(1) + '" height="' + rowH + '" class="tr-hit" data-tip="' + esc(st.label + ' · ' + longDate(st.from) + (st.to ? ' – ' + longDate(st.to) : ' onwards') + (st.length ? ' · ' + st.length : '') + ' · ' + (st.status || state)) + '"/>';
  });
  if (today >= start && today < end) svg += '<line x1="' + X(today).toFixed(1) + '" x2="' + X(today).toFixed(1) + '" y1="1" y2="' + (H - 12) + '" class="plan-today"/>';
  svg += '</svg>';
  const key = '<div class="tr-key"><span><i class="plan-k now"></i>Now</span><span><i class="plan-k done"></i>Done</span><span><i class="plan-k next"></i>Agreed</span><span><i class="plan-k proposed"></i>Proposed</span><span><i class="plan-k settle"></i>Settling</span><span><i class="plan-k today"></i>Today</span></div>';
  const list = steps.map((st) => {
    const state = stepState(st, today);
    const w = stepWindow(st, today);
    const prog = state === 'now' ? ' · day ' + dayNum(st.from, today) + (st.to ? ' of ' + dayNum(st.from, st.to) : '') : '';
    const settling = state === 'now' && w && w.settleEnd && today <= w.settleEnd ? '<div class="ps-note">Settling until ' + esc(longDate(w.settleEnd)) + ': the last 7 days are the ones compared.</div>' : '';
    return '<div class="plan-step ' + state + '"><div class="ps-top"><b>' + esc(st.label) + '</b><span class="ps-chip ' + state + '">' + esc(st.status || state) + '</span></div>' +
      '<div class="ps-dates">' + esc(longDate(st.from)) + (st.to ? (st.to !== st.from ? ' – ' + esc(longDate(st.to)) : '') : ' onwards') + (st.length ? ' · ' + esc(st.length) : '') + prog + '</div>' +
      (st.change ? '<div class="ps-change">' + esc(st.change) + '</div>' : '') + (st.watch ? '<div class="ps-watch">Watch: ' + esc(st.watch) + '</div>' : '') + settling + '</div>';
  }).join('');
  return svg + key + (cfg.plan.note ? '<p class="small">' + esc(cfg.plan.note) + '</p>' : '') + (withCompare ? patBtn('steps', 'Compare steps') : '') + '<div class="plan-list">' + list + '</div>' +
    '<p class="small">From the health tracker’s Meds tab (PLAN). Proposed steps aren’t agreed yet.</p>';
}
/* Compare steps: each step's judged days (last 7 of a long step) against the step before and the baseline. */
function stepsCompare(T2, today) {
  const G = giData();
  const steps = planSteps().filter((st) => (st.to ? dayNum(st.from, st.to) : 99) >= 3);
  const p = { title: 'Compare steps', comps: [], note: 'Each step is judged on its last 7 days when it runs 10 days or more (the days before are settling); shorter steps use every day. Averages of the days with readings; needs 3+ days on each side. Lower is better except clarity and sleep quality.' };
  const METRICS = [
    ['Pain', (k) => { const x = T2.by[k]; return x ? symVal(x.d, 'p') : undefined; }, false],
    ['Stiffness', (k) => { const x = T2.by[k]; return x ? symVal(x.d, 's') : undefined; }, false],
    ['Fatigue', (k) => { const x = T2.by[k]; return x ? symVal(x.d, 'f') : undefined; }, false],
    ['Mental clarity', (k) => { const x = T2.by[k]; const v = x ? symVal(x.d, 'g') : undefined; return typeof v === 'number' ? 10 - v : undefined; }, true],
    ['Stomach on waking', (k) => (G && G.by[k] ? G.by[k][1] : undefined), false],
    ['Sleep quality', (k) => { const x = T2.by[k]; return x ? x.d.q : undefined; }, true]
  ];
  const avg = (w, f) => { if (!w || !w.start) return null; const v = []; for (let k = w.start; k <= w.end; k = addDays(k, 1)) { const y = f(k); if (typeof y === 'number') v.push(y); } return v.length >= 3 ? { m: mean1(v), n: v.length } : null; };
  const card = (a, b, title) => {
    const wa = stepWindow(a, today), wb = stepWindow(b, today);
    if (!wa || !wb) return;
    const rows = METRICS.map(([name, f, up]) => {
      const x = avg(wa, f), y = avg(wb, f);
      if (!x || !y) return '';
      const d = y.m - x.m, good = up ? d > 0 : d < 0;
      const verdict = Math.abs(d) < 0.5 ? 'same' : good ? 'better' : 'worse';
      return '<tr><td>' + name + '</td><td>' + x.m.toFixed(1) + '</td><td>' + y.m.toFixed(1) + '</td><td class="pt-v ' + verdict + '">' + (verdict === 'same' ? 'about the same' : verdict) + '</td></tr>';
    }).join('');
    p.html = (p.html || '') + '<div class="pt"><div class="pt-h">' + esc(title) + '</div>' + (rows ? '<table class="cmp"><tr><th></th><th>' + esc(a.label.split(' · ')[0]) + '</th><th>' + esc(b.label.split(' · ')[0]) + '</th><th></th></tr>' + rows + '</table>' : '<p class="small">Not enough days with readings yet.</p>') +
      '<p class="small">' + esc(shortDate(wa.start || a.from) + '–' + shortDate(wa.end) + ' vs ' + shortDate(wb.start || b.from) + '–' + shortDate(wb.end)) + '</p></div>';
  };
  for (let i = 1; i < steps.length; i++) if (steps[i].from <= today) card(steps[i - 1], steps[i], 'Step ' + steps[i].label + ' vs the step before');
  const base = steps.find((st) => /baseline/i.test(st.label) && st.from <= today);
  if (base) steps.filter((st) => st !== base && st.from <= today).forEach((st) => card(base, st, st.label + ' vs the baseline'));
  if (!p.html) p.empty = 'Nothing to compare yet: the first comparison appears once the second step has 3 days of readings (from ' + (steps[1] ? longDate(steps[1].from) : 'the next step') + ').';
  return p;
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
  let html = '<section class="card" aria-label="Check-in"><div class="check-row">' +
    '<button type="button" class="check-toggle" data-act="toggle" aria-expanded="' + S.open + '" aria-controls="check-body">' +
    '<span aria-hidden="true"></span><span><h2>Check-in</h2><span class="sub">' + (S.open ? '' : esc(last)) + '</span></span>' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></div>';
  if (S.open) {
    const stage = S.stage || guessStage();
    const list = (period === 'Wake' && stage === 'bed' ? SLEEP.map(([k, l, m]) => [k, l, m]) : []).concat(SCALES.map(([k, l]) => [k, l, 10]));
    html += '<div id="check-body" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="grid3" role="group" aria-label="When">' + ['Wake', 'Day', 'Bed'].map((p) =>
        '<button type="button" class="seg" data-act="period" data-v="' + p + '" aria-pressed="' + (period === p) + '">' + p + '</button>').join('') + '</div>' +
      (period === 'Wake' ? '<div class="grid2 stage-row" role="group" aria-label="Wake stage">' + [['bed', 'In bed'], ['up', 'Getting up']].map(([k, l]) =>
        '<button type="button" class="seg" data-act="stage" data-v="' + k + '" aria-pressed="' + (stage === k) + '">' + l + '</button>').join('') + '</div>' : '') + '<div>' +
      list.map(([k, l, max]) => {
        const v = S.scores[k];
        const set = v !== undefined;
        return '<div class="scale"><label for="r-' + k + '">' + l + '</label>' +
          '<input id="r-' + k + '" type="range" min="0" max="' + max + '" step="0.5" value="' + (set ? v : max / 2) + '" data-score="' + k + '"' + (set ? '' : ' class="unset"') + '>' +
          '<output id="o-' + k + '" for="r-' + k + '"' + (set ? '' : ' class="unset"') + '>' + (set ? v : '–') + '</output></div>';
      }).join('') + '</div>' +
      (period === 'Wake' ? '<div class="sleep-times" role="group" aria-label="Sleep times">' + [['bed', 'Went to sleep'], ['wake', 'Woke'], ['up', 'Got up']].map(([k, l]) =>
        '<label><span>' + l + '</span><input type="time" data-sleep="' + k + '" value="' + esc(S.sleepT[k]) + '"></label>').join('') + '</div>' : '') +
      momentsView() +
      '<input type="text" data-field="checkNote" value="' + esc(S.checkNote) + '" placeholder="Note (optional)" aria-label="Check-in note" autocomplete="off">' +
      '<button type="button" class="log wide" id="check-save" data-act="checkin"></button></div>';
  }
  return html + '</section>';
}

/* Typing guard: background refreshes (saving, config, the 60 s tick) wait until you leave the text box,
   so the box doesn't lose focus mid-word. Taps you make still re-render straight away, keeping your place. */
function typingInLog() {
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('#log-view') && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(range|checkbox|radio)$/.test(a.type) && a.id !== 'focus-proxy');
}
function logRenderSoft() { if (typingInLog()) { S.dirty = true; return; } logRender(); }
document.addEventListener('focusout', (e) => {
  if (!S.dirty || !(e.target.closest && e.target.closest('#log-view'))) return;
  setTimeout(() => { if (S.dirty && !typingInLog()) logRender(); }, 60);
});
function logRender() {
  if (view !== 'log') return;
  S.dirty = false;
  const ae = document.activeElement;
  const keep = ae && ae.closest && ae.closest('#log-main') && /^(INPUT|TEXTAREA)$/.test(ae.tagName)
    ? { sel: ae.id ? '#' + ae.id : ae.dataset.field ? '[data-field="' + ae.dataset.field + '"]' : ae.dataset.sleep ? '[data-sleep="' + ae.dataset.sleep + '"]' : '', a: ae.selectionStart, b: ae.selectionEnd } : null;
  if (!$('log-main')) { $('log-view').innerHTML = '<input id="focus-proxy" class="focus-proxy" type="text" aria-hidden="true" tabindex="-1"><div id="log-main"></div><div id="log-more" class="log-more"></div>'; }
  const app = $('log-main');
  const head = (actions) => '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' + actions +
    (Conn.canLog() ? '<button type="button" class="icon-btn' + (S.refreshing ? ' busy' : '') + '" data-act="refresh" aria-label="Refresh"' + (S.refreshing ? ' aria-busy="true"' : '') + '>' + REFRESH_SVG + '</button>' : '') +
    '<button type="button" class="icon-btn" data-act="settings" aria-label="Settings">' + GEAR + '</button></div></div><h1 class="page-title">Log</h1>';
  if (!Conn.canLog()) {
    app.innerHTML = head('') + '<div class="notice">Pair this device once to start logging. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
      '<button type="button" class="log wide" data-act="pair">Pair this device</button></div>';
    return;
  }
  const now = new Date();
  const today = dayKey(now);
  const timeLabel = S.time ? (dayKey(S.time) === today ? '' : S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(S.time) : 'Now · ' + hm(now);
  const rows = todayEntries().slice().reverse();
  const failed = recent.filter((r) => r.day === today && r.status === 'failed');
  const waiting = queue.length;
  app.innerHTML =
    head('') +
    // The time pill floats at the top while you scroll; the panel opens here, or inside a sheet when one is open.
    '<div class="time-bar">' + timePill(timeLabel) + '</div>' + (S.timeOpen && !S.sheet ? timePanel(now) : '') +
    trialView() + logInboxView() + checkinView() + quickView() +
    (waiting ? '<div class="queue-note"><span>' + waiting + ' waiting to send</span><button type="button" class="link-btn" data-act="flush">Send now</button></div>' : '') +
    (rows.length || failed.length ? '<section class="recent" aria-label="Logged today"><h2>LOGGED TODAY</h2>' + missingRows().map((m) =>
      '<div class="lrow warn"><span class="t">' + esc(m.r.hm) + '</span><span>' + esc(m.miss.join(', ')) + ' not in the sheet</span><button type="button" class="link-btn" data-act="readd" data-v="' + esc(m.r.id) + '">Re-add</button></div>').join('') + rows.map((r) =>
      '<div class="lrow"><span class="t">' + esc(r.hm || '–') + '</span><span>' + esc(r.text) + '</span>' +
      (r.status === 'pending' ? '<button type="button" class="link-btn" data-act="undo" data-v="' + esc(r.id) + '">Undo</button>' :
        r.local && r.status !== 'saved' ? '<span class="st">Waiting</span>' : '<span class="st">' + esc(r.src || '') + '</span>') + '</div>').join('') +
      failed.map((r) => '<div class="lrow"><span class="t">' + esc(r.hm) + '</span><span>' + esc(r.text) + '</span><span class="st bad">Not saved</span></div>').join('') + '</section>' : '') +
    sheetView();
  S.sheetFresh = false;
  document.body.classList.toggle('sheet-open', !!S.sheet || !!TR.pop);
  updateCheckButton();
  if (keep && keep.sel) {
    const el = app.querySelector(keep.sel);
    if (el) { el.focus({ preventScroll: true }); try { if (keep.a !== null && keep.a !== undefined) el.setSelectionRange(keep.a, keep.b); } catch (e) {} }
  }
}
const CLOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function timePill(label) {
  return '<button type="button" class="pill' + (S.time ? ' set' : '') + '" data-act="time" aria-expanded="' + S.timeOpen + '" aria-label="Time for the next entry: ' + esc(label) + '">' + CLOCK_SVG + esc(label) + '</button>';
}
function timePanel(now) {
  return '<div class="time-panel"><label for="time-input" class="small">Time for the next entry</label>' +
    '<input id="time-input" type="datetime-local" value="' + localInputValue(S.time || now) + '" max="' + localInputValue(new Date(now.getTime() + 10 * 60000)) + '">' +
    '<div class="btns"><button type="button" class="log" data-act="time-set">Use this time</button><button type="button" class="seg" data-act="time-now">Now</button></div></div>';
}
/* Safety net: a medication entry this phone saved whose rows have since gone from the sheet (seen on 28 and
   29 Oct, cause unknown). Only checked against a sheet read taken after the save. */
function missingRows() {
  const hk = healthKey(new Date());
  if (!Array.isArray(cfg.todayLog) || cfg.todayHday !== hk || !cfg.at) return [];
  return recent.filter((r) => r.kind === 'meds' && r.status === 'saved' && r.hday === hk && r.savedAt && !r.readded && cfg.at > r.savedAt + 3000 && Array.isArray(r.meds))
    .map((r) => {
      const rows = cfg.todayLog.filter((x) => x.id === r.id);
      const miss = r.meds.filter((m) => !rows.some((x) => String(x.text || '').indexOf(m) === 0));
      return miss.length ? { r, miss } : null;
    }).filter(Boolean);
}
/* Moments: notable tiredness or weakness, one tap (tracking from 29 Oct 2026). Kept out of day averages. */
const MOMENTS = ['Tired', 'Very tired', 'Weak'];
const MOMENTS_SINCE = '2026-10-29';
function momentsView() {
  const today = todayEntries().filter((r) => r.kind === 'moment');
  return '<div class="moments" role="group" aria-label="Log a moment"><span class="moments-h">Moment</span>' + MOMENTS.map((m) => {
    const n = today.filter((r) => String(r.text || '').split(' · ')[0] === m).length;
    return '<button type="button" class="moment-btn" data-act="moment-open" data-v="' + m + '">' + m + (n ? '<small>' + n + '</small>' : '') + '</button>';
  }).join('') + '</div>';
}
/* Today's entries (this health day, 4am cut-off) from every source: the receiver's list (HealthLog v12),
   plus anything on this phone that hasn't reached it yet. Oldest first. */
function todayEntries() {
  const hk = healthKey(new Date());
  const server = Array.isArray(cfg.todayLog) && cfg.todayHday === hk ? cfg.todayLog : [];
  const ids = new Set(server.map((x) => x.id).filter(Boolean));
  const local = recent.filter((r) => (r.hday || r.day) === hk && r.status !== 'failed' && !ids.has(r.id))
    .map((r) => ({ hm: r.hm, kind: r.kind, text: r.text, min: r.minutes || 0, id: r.id, status: r.status, local: true }));
  const order = (t) => (!t ? '9' : t < '04:00' ? '2' + t : '1' + t);
  return server.map((x) => Object.assign({ src: x.via && x.via !== 'App' ? x.via : '' }, x)).concat(local).sort((a, b) => order(a.hm).localeCompare(order(b.hm)));
}

/* ---------- Log page: one-line inbox (same queue and sender as Today's inbox) ---------- */
function logInboxView() {
  if (!Conn.paired()) return '';
  return '<form id="log-inbox-form" class="mini-inbox" autocomplete="off"><input type="text" id="log-inbox-text" data-field="inboxText" value="' + esc(S.inboxText) +
    '" placeholder="Add to inbox…" aria-label="Add to inbox" enterkeyhint="send" maxlength="2000"><button type="submit" class="log">Send</button></form>' +
    '<div id="log-inbox-status" class="mini-status" role="status" aria-live="polite">' + esc(S.inboxStatus || (inboxQueue.length ? 'Waiting to send (' + inboxQueue.length + ')' : '')) + '</div>';
}
function setLogInboxStatus(text, clearAfter) {
  S.inboxStatus = text;
  const el = $('log-inbox-status'); if (el) el.textContent = text;
  if (clearAfter) setTimeout(() => { if (S.inboxStatus === text) setLogInboxStatus(''); }, clearAfter);
}
function logInboxSubmit() {
  const text = (S.inboxText || '').trim();
  if (!text) return;
  queueInbox(text, 'log');
  S.inboxText = '';
  const el = $('log-inbox-text'); if (el) el.value = '';
  setLogInboxStatus(navigator.onLine ? 'Sending…' : 'Waiting to send');
  inboxFlush(true);
}

/* ---------- quick-log buttons: each opens a bottom sheet ---------- */
const QI = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const QUICK = [
  ['meds', 'Medication', QI('<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)"/><path d="m9.6 9.2 4.8 5.6"/>')],
  ['bowel', 'Bowel', QI('<path d="M12 3.5s5.5 6 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5z"/>')],
  ['food', 'Food', QI('<path d="M7 3v7m-2.5-7v4.5a2.5 2.5 0 0 0 5 0V3M7 10v11M17 21V3c-2 1-3.5 3.5-3.5 7v3H17"/>')],
  ['activity', 'Activity', QI('<circle cx="13.5" cy="4.5" r="1.8"/><path d="m8 21 3-6 3 2.5V21M11 15l1.2-5.5L16 12l3-1M12.2 9.5 8.5 10.5 7 13.5"/>')]
];
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
/* Doses logged today per medicine (server count + this phone's not-yet-sent ones). */
function medTakenToday(m) {
  const hk = healthKey(new Date());
  return (((cfg.today || {}).meds || {})[m.name] || 0) +
    recent.filter((r) => r.kind === 'meds' && r.hday === hk && r.status !== 'saved' && r.status !== 'failed' && (r.meds || []).includes(m.name)).length;
}
function quickCount(kind) {
  if (kind === 'meds') {
    // Routine medicines ("Per day" above 0 in Log settings): how many of today's doses are logged, and how many are left.
    const routine = (cfg.meds || []).filter((m) => Number(m.perDay) > 0 && !maxTabs(m));
    const total = routine.reduce((t, m) => t + Number(m.perDay), 0);
    if (!total) return '';
    const done = routine.reduce((t, m) => t + Math.min(medTakenToday(m), Number(m.perDay)), 0);
    return done >= total ? 'All ' + total + ' ✓' : done + '/' + total + ' · ' + (total - done) + ' left';
  }
  const rows = todayEntries().filter((r) => r.kind === kind);
  if (kind === 'activity') { const mins = rows.reduce((t, r) => t + (r.min || 0), 0); return mins ? mins + ' min' : rows.length ? rows.length + ' today' : ''; }
  return rows.length ? rows.length + ' today' : '';
}
function quickView() {
  return '<div class="quick4" role="group" aria-label="Quick log">' + QUICK.map(([k, label, icon]) => {
    const c = quickCount(k);
    return '<button type="button" class="quick" data-act="sheet" data-v="' + k + '" aria-haspopup="dialog">' + icon + '<span>' + label + '</span>' +
      (c ? '<small>' + esc(c) + '</small>' : '') + '</button>';
  }).join('') + '</div>';
}
function sheetView() {
  if (!S.sheet || !Conn.canLog()) return '';
  const title = { meds: 'Medication', bowel: 'Bowel', food: 'Food', activity: 'Activity', moment: 'Moment', plan: 'Medication plan' }[S.sheet];
  let body = '', btn = '';
  if (S.sheet === 'meds') {
    const n = S.meds.length;
    btn = '<button type="button" class="log" data-act="meds"' + (n ? '' : ' disabled') + '>' + (n ? 'Log ' + n : 'Log') + '</button>';
    body = '<div class="chips">' + (cfg.meds || []).map((m) =>
      '<button type="button" class="chip med" data-act="med" data-v="' + esc(m.name) + '" aria-pressed="' + S.meds.includes(m.name) + '"><small class="dose-top">' + esc(chipDoseTop(m)) + '</small><span class="med-name"><b>' + esc(m.name) + '</b>' + takenMark(m) + '</span></button>').join('') +
      '<button type="button" class="chip other" data-act="other-med">Other…</button></div>' + doseRows() + historyView();
  } else if (S.sheet === 'bowel') {
    btn = '<button type="button" class="log" data-act="bowel"' + (S.bristol ? '' : ' disabled') + '>Log</button>';
    body = bowelBody();
  } else if (S.sheet === 'moment') {
    btn = '<button type="button" class="log" data-act="moment-log"' + (S.moment ? '' : ' disabled') + '>Log</button>';
    body = '<div class="chips">' + MOMENTS.map((m) => '<button type="button" class="chip" data-act="moment-pick" data-v="' + m + '" aria-pressed="' + (S.moment === m) + '"><b>' + m + '</b></button>').join('') + '</div>' +
      '<input type="text" id="moment-note" data-field="momentNote" value="' + esc(S.momentNote) + '" placeholder="Note (optional)" aria-label="Moment note" autocomplete="off" enterkeyhint="send">' +
      '<p class="small">For moments that stand out. Kept separate from your day scores. Tracking since 29 Oct.</p>';
  } else if (S.sheet === 'plan') {
    body = planHtml(healthKey(new Date()), false);
  } else if (S.sheet === 'food') {
    btn = '<button type="button" class="log" id="food-log" data-act="food"' + (S.food.trim() ? '' : ' disabled') + '>Log</button>';
    body = '<input type="text" id="food-input" data-field="food" value="' + esc(S.food) + '" placeholder="What did you eat?" aria-label="What did you eat" autocomplete="off" enterkeyhint="send">' +
      '<div class="chips">' + (cfg.foods || []).map((f) => '<button type="button" class="chip food" data-act="food-chip" data-v="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div>';
  } else if (S.sheet === 'activity') {
    btn = '<button type="button" class="log" id="act-log" data-act="activity"' + (actRoute() ? '' : ' disabled') + '>' + (actRoute() === 'inbox' ? 'Send to inbox' : 'Log') + '</button>';
    const chips = (act, list, cur, fmt) => '<div class="chips">' + list.map((x) => '<button type="button" class="chip food" data-act="' + act + '" data-v="' + esc(x) + '" aria-pressed="' + (cur === x) + '">' + esc(fmt ? fmt(x) : x) + '</button>').join('') + '</div>';
    body = '<input type="text" id="act-input" data-field="actText" value="' + esc(S.actText) + '" placeholder="What did you do?" aria-label="What did you do" autocomplete="off" enterkeyhint="send">' +
      '<div class="opt-h">Type</div>' + chips('act-type', ACT_TYPES, S.actType) +
      '<div class="opt-h">Minutes</div>' + chips('act-min', ACT_MINS.map(String), S.actMin === null ? null : String(S.actMin), (x) => (x === '120' ? '120+' : x)) +
      '<div class="opt-h">Effort</div><div class="grid3" role="group" aria-label="Effort">' + ACT_EFFORT.map((e) => '<button type="button" class="seg" data-act="act-effort" data-v="' + e + '" aria-pressed="' + (S.actEffort === e) + '">' + e + '</button>').join('') + '</div>' +
      '<p class="small" id="act-hint">' + actHint() + '</p>';
  }
  const now = new Date();
  const label = S.time ? (dayKey(S.time) === dayKey(now) ? '' : S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(S.time) : 'Now · ' + hm(now);
  const when = S.sheet === 'plan' ? '' : '<div class="sheet-time">' + timePill(label) + '</div>' + (S.timeOpen ? timePanel(now) : '');
  return '<div class="sheet-backdrop' + (S.sheetFresh ? ' fresh' : '') + '" data-act="sheet-close"></div>' +
    '<div class="sheet' + (S.sheetFresh ? ' fresh' : '') + '" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
    '<div class="sheet-grab" aria-hidden="true"></div><div class="sheet-head"><h2 id="sheet-title">' + title + '</h2>' + btn +
    '<button type="button" class="icon-btn sheet-x" data-act="sheet-close" aria-label="Close">' + X_SVG + '</button></div>' + when + body + '</div>';
}
/* Type + minutes → straight to Events; text only → the inbox ("Activity: …") for the processor to sort. */
function actRoute() { return S.actType && S.actMin ? 'log' : S.actText.trim() ? 'inbox' : ''; }
function actHint() {
  const r = actRoute();
  return r === 'log' ? 'Saves straight to your health log.' : r === 'inbox' ? 'Pick a type and minutes to save it directly, or send the text to the inbox to be sorted.' : 'Pick a type and minutes, or just describe it.';
}
function updateActButton() {
  const b = $('act-log'); if (!b) return;
  b.disabled = !actRoute(); b.textContent = actRoute() === 'inbox' ? 'Send to inbox' : 'Log';
  const h = $('act-hint'); if (h) h.textContent = actHint();
}
/* iPhone only shows the keyboard if focus happens inside the tap itself, so focus a hidden input
   first, rebuild the page with the sheet, then move focus to the real field. */
function openSheet(kind) {
  // Food opens the keyboard; Activity doesn't, so its type and minute buttons stay in view.
  const field = kind === 'food' ? 'food-input' : null;
  if (field) { const proxy = $('focus-proxy'); if (proxy) proxy.focus(); }
  S.sheet = kind; S.sheetFresh = true;
  logRender();
  if (field && $(field)) $(field).focus();
}
function closeSheet() {
  if (!S.sheet) return;
  S.sheet = null;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  logRender();
}
let sheetDrag = null;
document.addEventListener('touchstart', (e) => {
  const sh = e.target.closest && e.target.closest('#sheet, #tr-sheet');
  if (!sh || sh.scrollTop > 0 || e.target.closest('input')) return;
  sheetDrag = { y: e.touches[0].clientY, dy: 0, el: sh };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!sheetDrag) return;
  sheetDrag.dy = e.touches[0].clientY - sheetDrag.y;
  if (sheetDrag.dy > 0) sheetDrag.el.style.transform = 'translateY(' + sheetDrag.dy + 'px)';
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!sheetDrag) return;
  const d = sheetDrag; sheetDrag = null;
  if (d.dy > 90) { if (d.el.id === 'tr-sheet') closePatterns(); else closeSheet(); } else d.el.style.transform = '';
});
/* Enter (phone keyboard's Done/Go too) logs whatever the open sheet is for, if it's ready. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.shiftKey || !S.sheet) return;
  const sh = $('sheet');
  if (!sh || (e.target.closest && e.target.closest('button'))) return;
  e.preventDefault();
  const btn = sh.querySelector('.sheet-head .log');
  if (btn && !btn.disabled) btn.click();
});
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (S.sheet) closeSheet(); else if (TR.pop) closePatterns(); });
/* Flare: one tap logs "Flare" for today (Symptom update). Shown on the Health calendar. */
function flareToday() {
  const hk = healthKey(new Date());
  const local = recent.find((r) => r.kind === 'flare' && r.hday === hk && r.status !== 'failed');
  return (cfg.today && cfg.today.flare) || (local ? local.hm : '');
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

/* The strength sits above the name and never changes on selection, so the chips don't shift around. */
function chipDoseTop(m) { return isDosed(m) ? doseShort(medOptions(m)) + (maxTabs(m) ? ' · 1–' + maxTabs(m) : '') : (m.strength || ''); }

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

function bowelBody() {
  return '<div class="grid7" role="group" aria-label="Bristol type">' + [1, 2, 3, 4, 5, 6, 7].map((n) =>
      '<button type="button" class="sq" data-act="bristol" data-v="' + n + '" aria-pressed="' + (S.bristol === n) + '" aria-label="Bristol type ' + n + '">' + n + '</button>').join('') + '</div>' +
    (S.bristol ? '<div class="grid-size" role="group" aria-label="Size">' + ['Small', 'Medium', 'Large'].map((z) =>
      '<button type="button" class="seg" data-act="size" data-v="' + z + '" aria-pressed="' + (S.size === z) + '">' + z + '</button>').join('') +
      '<button type="button" class="seg" data-act="urgent" aria-pressed="' + S.urgent + '">Urgent</button></div>' +
      '<input type="text" data-field="bowelNote" value="' + esc(S.bowelNote) + '" placeholder="Note (optional)" aria-label="Bowel note" autocomplete="off">' : '');
}

function logMoreRender() {
  const more = $('log-more');
  if (!more) return;
  if (!more.dataset.built) {
    more.dataset.built = '1';
    more.innerHTML = '<div class="tv"><div class="recent-buttons"><button id="toggle-medication" type="button" aria-expanded="false" aria-controls="medications">Recent meds</button>' +
      '<button id="toggle-log-inbox" type="button" aria-expanded="false" aria-controls="log-recent-logs">Recent inbox entries</button></div>' +
      '<div id="medications" aria-live="polite" hidden></div><div id="log-recent-logs" aria-live="polite" hidden></div></div>' + fileLinks([['Health sheet', LINKS.healthSheet], ['Health GPT', LINKS.healthGpt]]);
    $('toggle-log-inbox').onclick = () => {
      const open = $('log-recent-logs').hidden;
      $('log-recent-logs').hidden = !open;
      $('toggle-log-inbox').setAttribute('aria-expanded', String(open));
      if (open) loadRecentLogs('log-recent-logs');
    };
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
  const n = Object.keys(S.scores).length + ((S.period || guessPeriod()) === 'Wake' ? Object.values(S.sleepT).filter(Boolean).length : 0);
  b.disabled = !n;
  b.textContent = n ? 'Save check-in · ' + n + (n === 1 ? ' entry' : ' entries') : 'Save check-in';
}

function saveLocal() { LS.set('recent', recent.slice(0, 40)); LS.set('queue', queue); }

/* A time picked in the open time panel counts even if "Use this time" wasn't pressed. */
function pickedTime() {
  const el = $('time-input');
  if (!S.timeOpen || !el || !el.value) return null;
  const d = new Date(el.value);
  return !isNaN(d) && d.getTime() <= Date.now() + 10 * 60000 && d.getTime() >= Date.now() - 3 * 86400000 && Math.abs(d - Date.now()) > 60000 ? d : null;
}

function commit(kind, payload, label, extra) {
  const when = S.time || pickedTime() || new Date();
  const timeSet = !!(S.time || pickedTime());
  const entry = Object.assign({ kind, entryId: newId(), time: when.toISOString(), timeSet }, payload);
  recent.unshift(Object.assign({ id: entry.entryId, day: dayKey(when), hday: healthKey(when), hm: hm(when), at: when.toISOString(), text: label, kind, status: 'pending' }, extra || {}));
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
  if (r) { r.status = status; if (error) r.error = error; if (status === 'saved') r.savedAt = Date.now(); }
  saveLocal();
  logRenderSoft();
}

async function logFlush() {
  if (sending || !queue.length || !navigator.onLine || !Conn.canLog()) { logRenderSoft(); return; }
  sending = true;
  let saved = 0, failedMsg = '';
  try {
    while (queue.length) {
      const entry = queue[0];
      let res;
      try { res = await api(Object.assign({ action: 'log' }, entry)); } catch (e) { res = null; }
      if (res && res.success) { queue.shift(); setStatus(entry.entryId, 'saved'); saved++; continue; }
      if (res && res.auth === false) { failedMsg = 'Not sent: this device needs pairing again (Settings).'; break; }
      if (res && res.permanent) { queue.shift(); setStatus(entry.entryId, 'failed', res.error); failedMsg = res.error || 'Not saved'; continue; }
      if (res && res.error === 'Not authorised.') { failedMsg = 'Key not accepted. Pair this device in Settings.'; }
      break;
    }
  } finally { sending = false; saveLocal(); }
  if (failedMsg) toast(failedMsg);
  else if (saved && $('toast').hidden) toast('Saved ✓');
  else if (queue.length && !navigator.onLine) toast('Saved on this device · will send when online');
  if (saved) logRefreshConfig();
  logRenderSoft();
}

async function logRefreshConfig() {
  if (!Conn.canLog()) return;
  try {
    const res = await api({ action: 'config' });
    if (res && res.success) {
      cfg = { meds: res.meds || FALLBACK.meds, foods: res.foods || [], trial: res.trial || null, history: res.history || null, symptoms: res.symptoms || null, recentMeds: res.recentMeds,
        todayLog: res.todayLog, todayHday: healthKey(new Date()), at: Date.now(), plan: res.plan || null, clarity: !!res.clarity, today: res.today || FALLBACK.today };
      if ($('medications') && !$('medications').hidden) renderRecentMeds();
      if (S.sheet && document.activeElement && /INPUT/.test(document.activeElement.tagName) && document.activeElement.closest('#sheet')) {
        LS.set('config', { data: cfg, day: dayKey(new Date()) });   // don't rebuild a sheet while typing in it
        if (view === 'trends') trendsRender();
        return true;
      }
      LS.set('config', { data: cfg, day: dayKey(new Date()) });
      logRenderSoft();
      if (view === 'trends') trendsRender();
      return true;
    }
  } catch (e) {}
  return false;
}

function logAct(el) {
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'sheet') { openSheet(v); return; }
  if (act === 'moment-open') { S.moment = v; S.momentNote = ''; openSheet('moment'); return; }
  if (act === 'moment-pick') { S.moment = v; logRender(); return; }
  if (act === 'moment-log') {
    if (!MOMENTS.includes(S.moment)) return;
    const note = S.momentNote.trim();
    commit('moment', { moment: S.moment, note }, S.moment + (note ? ' · ' + note : ''));
    S.moment = null; S.momentNote = ''; closeSheet();
    return;
  }
  if (act === 'plan-open') { openSheet('plan'); return; }
  if (act === 'readd') {
    const m = missingRows().find((x) => x.r.id === v);
    if (!m) return;
    const doses = {};
    m.miss.forEach((name) => { if (m.r.doses && m.r.doses[name]) doses[name] = m.r.doses[name]; });
    const at = m.r.at ? new Date(m.r.at) : null;
    if (at && !isNaN(at) && at.getTime() >= Date.now() - 3 * 86400000) S.time = at;
    m.r.readded = true; saveLocal();
    commit('meds', { meds: m.miss, doses }, m.miss.join(', ') + ' (re-added)', { meds: m.miss, doses });
    return;
  }
  if (act === 'sheet-close') { closeSheet(); return; }
  if (act === 'refresh') {
    if (S.refreshing) return;
    S.refreshing = true; logRender();
    Promise.all([logRefreshConfig(), sleepMs(600)]).then(([ok]) => { S.refreshing = false; logRender(); if (!ok) toast('Couldn’t refresh (offline?)'); logFlush(); });
    return;
  }
  if (act === 'act-type') { S.actType = S.actType === v ? null : v; logRender(); return; }
  if (act === 'act-min') { S.actMin = S.actMin === Number(v) ? null : Number(v); logRender(); return; }
  if (act === 'act-effort') { S.actEffort = S.actEffort === v ? null : v; logRender(); return; }
  if (act === 'activity') {
    const route = actRoute();
    const text = S.actText.trim();
    if (route === 'log') {
      const label = S.actType + ' · ' + (S.actMin >= 120 ? '120+' : S.actMin) + ' min' + (S.actEffort ? ' · ' + S.actEffort.toLowerCase() : '') + (text ? ' · ' + text : '');
      commit('activity', { type: S.actType, minutes: S.actMin, effort: S.actEffort || '', text }, label, { minutes: S.actMin });
    } else if (route === 'inbox') {
      queueInbox('Activity: ' + text + (S.actType ? ' (' + S.actType.toLowerCase() + ')' : '') + (S.actMin ? ', ' + S.actMin + ' min' : '') + (S.actEffort ? ', ' + S.actEffort.toLowerCase() : ''), 'log');
      setLogInboxStatus(navigator.onLine ? 'Sending…' : 'Waiting to send');
      inboxFlush(true);
      toast('Sent to inbox: ' + text);
    } else return;
    S.actText = ''; S.actType = null; S.actMin = null; S.actEffort = null; closeSheet();
    return;
  }
  if (act === 'flare') {
    if (flareToday()) { toast('Today is already marked as a flare.'); return; }
    commit('flare', {}, 'Flare');
    return;
  }
  if (act === 'toggle') {
    S.open = !S.open; if (S.open && !S.period) S.period = guessPeriod(); logRender();
    // Bring the check-in to the top of the screen so the sliders are in view.
    if (S.open) requestAnimationFrame(() => { const c = document.querySelector('#log-main section[aria-label="Check-in"]'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  else if (act === 'period') { S.period = v; if (v !== 'Wake' || (S.stage || guessStage()) === 'up') { delete S.scores.sleepq; delete S.scores.disturb; } logRender(); }
  else if (act === 'stage') { S.stage = v; if (v === 'up') { delete S.scores.sleepq; delete S.scores.disturb; } logRender(); }
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
    S.bristol = null; S.size = null; S.urgent = false; S.bowelNote = ''; closeSheet();
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
    S.meds = []; S.doses = {}; closeSheet();
  }
  else if (act === 'food') {
    const food = S.food.trim();
    if (!food) return;
    commit('food', { food }, food);
    S.food = ''; closeSheet();
  }
  else if (act === 'checkin') {
    const period = S.period || guessPeriod();
    const stage = period === 'Wake' ? (S.stage || guessStage()) : '';
    const times = period === 'Wake' ? Object.fromEntries(Object.entries(S.sleepT).filter(([, v]) => /^\d{2}:\d{2}$/.test(v))) : {};
    const n = Object.keys(S.scores).length, t = Object.keys(times).length;
    if (!n && !t) return;
    const tl = [times.bed ? 'slept ' + times.bed : '', times.wake ? 'woke ' + times.wake : '', times.up ? 'up ' + times.up : ''].filter(Boolean).join(', ');
    const word = stage === 'up' ? 'getting up' : stage === 'bed' ? 'in bed' : period.toLowerCase();
    // Receivers before HealthLog v13 only know "fog" (10 = heavy fog), so send that too until it's updated.
    const sc = Object.assign({}, S.scores);
    if (typeof sc.clarity === 'number') sc.fog = 10 - sc.clarity;
    commit('checkin', { period, stage, scores: sc, note: S.checkNote.trim(), sleep: times },
      'Check-in (' + word + ')' + (n ? ' · ' + n + (n === 1 ? ' rating' : ' ratings') : '') + (tl ? ' · ' + tl : ''), { wake: stage === 'bed', up: stage === 'up' });
    S.scores = {}; S.checkNote = ''; S.open = false; S.period = null; S.stage = null; S.sleepT = { bed: '', wake: '', up: '' }; logRender();
  }
  else if (act === 'trial') {
    const t = cfg.trial;
    if (!t) return;
    commit('trial', {}, t.button.replace(/ now$/i, ''));
  }
}

document.addEventListener('change', (ev) => {
  if (ev.target.id !== 'time-input') return;
  const d = ev.target.value ? new Date(ev.target.value) : null;
  if (d && !isNaN(d) && d.getTime() <= Date.now() + 10 * 60000 && d.getTime() >= Date.now() - 3 * 86400000) { S.time = d; S.timeOpen = false; logRender(); toast('Next entry will be logged at ' + hm(d)); }
  else if (d) toast('Pick a time in the last 3 days');
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.closest('#log-view')) return;
  if (el.dataset.score) {
    const k = el.dataset.score;
    S.scores[k] = Number(el.value);
    el.classList.remove('unset');
    const o = $('o-' + k); o.textContent = el.value; o.classList.remove('unset');
    updateCheckButton();
  } else if (el.dataset.sleep) {
    S.sleepT[el.dataset.sleep] = el.value;
    updateCheckButton();
  } else if (el.dataset.field) {
    S[el.dataset.field] = el.value;
    if (el.dataset.field === 'food') { const b = $('food-log'); if (b) b.disabled = !el.value.trim(); }
    if (el.dataset.field === 'actText') updateActButton();
  }
});

/* ================= TODAY view ================= */
const T = {
  tasks: [], loadedDate: '', rolloverMinutes: 40, choice: null, manual: false, req: 0, lastLoad: 0, built: false,
  completing: new Set(), carry: null, carryDone: new Set(), pendingLog: null, saving: false, panelReq: {}
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
    '<div id="pair-prompt" class="notice pair-prompt" hidden>Pair this device once to see your day here. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
      '<button type="button" class="log wide" id="pair-today">Pair this device</button></div>' +
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
  $('refresh').onclick = () => spin($('refresh'), refreshToday);
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
  return Promise.all([loadDay(false), $('recent-logs').hidden ? null : loadRecentLogs(), inboxFlush()]);
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
    loadCarryOver();
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

/* Ticking a task waits a few seconds with an Undo before it's sent to Todoist. */
const pendingDone = {};
const isCompleting = (id) => T.completing.has(id) || !!pendingDone[id];
function completeTodoist(id, check, row, after) {
  if (isCompleting(id)) return;
  row = row || (check.closest && check.closest('.ahead-row'));
  if (row) row.classList.add('done');
  // The celebration shows straight away with an Undo button; the completion is sent to Todoist when
  // the window closes (or after 2 minutes if it's left open).
  const send = () => { if (!pendingDone[id]) return; clearTimeout(pendingDone[id].t); delete pendingDone[id]; completeTodoistNow(id, check, row, after); };
  pendingDone[id] = {
    t: setTimeout(send, 120000), send,
    undo: () => { clearTimeout(pendingDone[id].t); delete pendingDone[id]; check.checked = false; check.disabled = false; if (row) row.classList.remove('done'); document.querySelectorAll('input[type=checkbox][data-task="' + id + '"]').forEach((c) => { c.checked = false; }); }
  };
  try { celebrateCompletion(id); } catch (e) { send(); }
}
async function completeTodoistNow(id, check, row, after) {
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
    T.carryDone.add(id);
    const saved = LS.get('cache.day', null);
    if (saved && saved.result) { saved.result.tasks = (saved.result.tasks || []).filter((t) => t.id !== id); LS.set('cache.day', saved); }
    if (T.built) renderTasks();
    if (after) after();
    if ($('next-days') && after !== loadNextFewDays && T.aheadAt) loadNextFewDays();
    message('Completed in Todoist.', 5000);
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
  check.checked = isCompleting(task.id);
  check.dataset.task = task.id;
  // Only the checkbox completes a task: the text can be selected and copied, and links open.
  const label = document.createElement('div');
  label.className = 'task-text';
  const name = document.createElement('div');
  name.appendChild(linkified(task.name));
  if (task.fromLabel) { const tag = document.createElement('span'); tag.className = 'carry-tag'; tag.textContent = 'from ' + task.fromLabel.replace(/ \d+ \w+$/, ''); tag.title = 'Not done on ' + task.fromLabel; name.appendChild(tag); }
  label.appendChild(name);
  if (task.description) {
    const desc = document.createElement('div');
    desc.className = 'sub';
    desc.appendChild(linkified(task.description.slice(0, 300)));
    label.appendChild(desc);
  }
  const duration = document.createElement('span');
  duration.className = 'duration';
  duration.textContent = task.duration ? task.duration + ' min' : '';
  check.onchange = () => { if (check.checked) completeTodoist(task.id, check, row); };
  row.append(check, label, duration);
  return row;
}

/* Unfinished tasks from earlier days show on the normal Today view, tagged "from Tue". Nothing is moved in Todoist. */
function carriedTasks() {
  if (!T.carry || T.manual || T.loadedDate !== londonWorkingDay(T.rolloverMinutes)) return [];
  const have = new Set(T.tasks.map((t) => t.id));
  return T.carry.filter((t) => !have.has(t.id) && !T.carryDone.has(t.id));
}
async function loadCarryOver() {
  if (!Conn.paired() || T.manual) return;
  const saved = LS.get('cache.carry', null);
  if (saved && !T.carry) { T.carry = saved.tasks; renderTasks(); }
  try {
    const res = await dash('getCarryOver', []);
    T.carry = (res && res.tasks) || [];
    LS.set('cache.carry', { at: Date.now(), tasks: T.carry });
    renderTasks();
  } catch (e) {}
}

function renderTasks() {
  $('focus').replaceChildren(); $('extra').replaceChildren();
  const all = T.tasks.concat(carriedTasks());
  const core = all.filter((t) => !t.optional), extra = all.filter((t) => t.optional);
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
  el.innerHTML = inboxQueue.length ? '<span>' + inboxQueue.length + ' inbox entr' + (inboxQueue.length === 1 ? 'y' : 'ies') + ' saved on this device, waiting to send</span><button type="button" class="link-btn" id="inbox-send">Send now</button>' : '';
  if (inboxQueue.length) $('inbox-send').onclick = () => inboxFlush(true);
}
function queueInbox(text, origin) {
  inboxQueue.push({ text, id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2), origin: origin || 'today' });
  LS.set('inboxQueue', inboxQueue);
  renderInboxQueue();
}
function saveInbox(event) {
  event.preventDefault();
  const text = $('log-text').value;
  if (!text.trim()) { $('log-status').textContent = 'Enter something to save.'; return; }
  queueInbox(text, 'today');
  $('log-text').value = '';
  $('log-status').textContent = navigator.onLine ? 'Sending…' : 'Saved on this device · will send when online.';
  renderInboxQueue();
  inboxFlush(true);
}
async function inboxFlush(manual) {
  if (inboxSending || !inboxQueue.length || !Conn.paired()) return;
  if (!navigator.onLine) {
    if (manual && $('log-status')) $('log-status').textContent = 'Saved on this device · will send when online.';
    if (manual) setLogInboxStatus('Waiting to send (' + inboxQueue.length + ')');
    return;
  }
  inboxSending = true;
  let sent = 0, problem = '', logSent = 0, logProblem = '';
  try {
    while (inboxQueue.length) {
      const item = inboxQueue[0];
      try {
        const res = await dash('saveDashboardLog', [item.text, item.id]);
        if (!res || !res.success) throw new Error('Unexpected server response');
        inboxQueue.shift();
        if (item.origin === 'log') logSent++; else sent++;
        LS.set('inboxQueue', inboxQueue);
      } catch (e) {
        if (!e.permanent) {
          problem = 'Saved on this device · couldn’t reach Google yet. It will retry.';
          logProblem = 'Waiting to send (' + inboxQueue.length + ')';
          break;
        }
        inboxQueue.shift();
        LS.set('inboxQueue', inboxQueue);
        if (item.origin === 'log') {
          if (!S.inboxText.trim()) { S.inboxText = item.text; const box = $('log-inbox-text'); if (box) box.value = item.text; }
          logProblem = 'Not sent: ' + e.message;
        } else {
          if ($('log-text') && !$('log-text').value.trim()) $('log-text').value = item.text;
          problem = 'Not saved: ' + e.message + ' Your text is back in the box.';
        }
      }
    }
  } finally { inboxSending = false; LS.set('inboxQueue', inboxQueue); }
  renderInboxQueue();
  if (logProblem) setLogInboxStatus(logProblem);
  else if (logSent) setLogInboxStatus('Sent ✓', 4000);
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
    '<div id="' + name + '-pair" class="notice pair-prompt" hidden>Pair this device once to see this page. It takes a code from the Ru - Inbox Receiver script on your Mac.' +
    '<button type="button" class="log wide" id="' + name + '-pair-btn">Pair this device</button></div>';
}
function pageEnter(name, title, panelId, after, load, stampKey) {
  const el = $(name + '-view');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = pageHead(name, title) + '<div id="' + panelId + '" aria-live="polite"></div>' + after;
    $(name + '-refresh').onclick = () => spin($(name + '-refresh'), () => { T[stampKey] = Date.now(); return load(); });
    $(name + '-settings').onclick = () => openSettings();
    $(name + '-pair-btn').onclick = () => openSettings('pair');
  }
  const paired = Conn.paired();
  $(name + '-pair').hidden = paired;
  $(panelId).hidden = !paired;
  if (paired && (!T[stampKey] || Date.now() - T[stampKey] > 120000)) { T[stampKey] = Date.now(); load(); }
}
function aheadEnter() { pageEnter('ahead', 'Ahead', 'next-days', '<section id="optional-week" class="optional-week" aria-live="polite"></section>', loadAhead, 'aheadAt'); }
function loadAhead() { return Promise.all([loadNextFewDays(), loadOptionalWeek()]); }

/* Task buttons on Ahead: "Today" moves it to today; "Later" offers +1 day, +3 days or next week.
   Recurring tasks are refused by the server so their repeat isn't lost. */
function taskActions(id, title, row) {
  const box = document.createElement('div'); box.className = 'task-actions';
  const today = document.createElement('button'); today.type = 'button'; today.className = 'move-today'; today.textContent = 'Today';
  today.setAttribute('aria-label', 'Move ' + title + ' to today');
  const later = document.createElement('button'); later.type = 'button'; later.className = 'move-today'; later.textContent = 'Later';
  later.setAttribute('aria-label', 'Push ' + title + ' back'); later.setAttribute('aria-expanded', 'false');
  const run = async (btn, fn, args, done) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await dash(fn, args);
      toast(done(res));
      LS.del('cache.day'); T.lastLoad = 0;
      loadAhead();
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      toast(/not a function/i.test(e.message) ? 'Needs the latest Optional-tasks file in the Life Dashboard script.' : e.message);
    }
  };
  today.onclick = () => run(today, 'moveTaskToToday', [id], () => 'Moved to today ✓');
  later.onclick = () => {
    const open = row.querySelector('.later-opts');
    if (open) { open.remove(); later.setAttribute('aria-expanded', 'false'); return; }
    later.setAttribute('aria-expanded', 'true');
    const opts = document.createElement('div'); opts.className = 'later-opts';
    [['plus1', '+1 day'], ['plus3', '+3 days'], ['nextweek', 'Next week']].forEach(([how, text]) => {
      const o = document.createElement('button'); o.type = 'button'; o.className = 'move-today'; o.textContent = text;
      o.onclick = () => run(o, 'rescheduleTask', [id, how], (res) => 'Moved to ' + keyToDate(res.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ✓');
      opts.appendChild(o);
    });
    row.appendChild(opts);
  };
  box.append(today, later);
  return box;
}

function loadOptionalWeek() {
  const panel = $('optional-week');
  if (!panel) return;
  return panelLoad('getOptionalTasks', 'optional-week', (result) => {
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
      check.disabled = T.completing.has(t.id); check.checked = isCompleting(t.id); check.dataset.task = t.id;
      check.onchange = () => { if (check.checked) completeTodoist(t.id, check, null, loadOptionalWeek); };
      const content = document.createElement('div');
      const a = document.createElement('a'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t.title; content.appendChild(a);
      const bits = [t.time, t.duration ? t.duration + ' min' : '', t.recurring ? 'repeats' : ''].filter(Boolean);
      if (bits.length) { const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = bits.join(' · '); content.appendChild(sub); }
      row.append(check, content);
      if (!t.recurring) row.appendChild(taskActions(t.id, t.title, row));
      panel.appendChild(row);
    });
  }, 'Loading optional tasks…');
}
function moneyEnter() { pageEnter('money', 'Money', 'money-panel', fileLinks([['Finances sheet', LINKS.moneySheet], ['Finances GPT', LINKS.moneyGpt]]), loadMoney, 'moneyAt'); }

function loadNextFewDays() {
  const panel = $('next-days');
  return panelLoad('getNextFewDays', 'next-days', (result) => {
    panel.replaceChildren();
    [result.calendarError, result.tasksError].filter(Boolean).forEach((error) => {
      const w = document.createElement('p'); w.className = 'status'; w.textContent = error; panel.appendChild(w);
    });
    result.days.forEach((day) => {
      const block = document.createElement('section'); block.className = 'ahead-day';
      const heading = document.createElement('h3'); heading.textContent = day.label; block.appendChild(heading);
      const group = (label, items, calendar) => {
        if (!items.length) return;
        items.forEach((item) => {
          const row = document.createElement('div'); row.className = 'ahead-row';
          const time = document.createElement('span'); time.className = 'ahead-time'; time.textContent = item.time || '';
          const content = document.createElement('div');
          let name;
          if (!calendar) { name = document.createElement('a'); name.href = item.url; name.target = '_blank'; name.rel = 'noopener'; }
          else name = document.createElement('span');
          name.textContent = item.title;
          content.appendChild(name);
          if (label === 'Deadlines') { const tag = document.createElement('span'); tag.className = 'deadline-tag'; tag.textContent = 'deadline'; content.appendChild(tag); }
          if (calendar && item.location) { const place = document.createElement('div'); place.className = 'sub'; place.textContent = item.location; content.appendChild(place); }
          if (!calendar) {
            row.classList.add('ahead-task');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.setAttribute('aria-label', 'Complete ' + item.title);
            const id = item.id || decodeURIComponent(String(item.url || '').split('/').pop());
            check.disabled = T.completing.has(id); check.checked = isCompleting(id); check.dataset.task = id;
            check.onchange = () => { if (check.checked) completeTodoist(id, check, null, loadNextFewDays); };
            row.appendChild(check);
          }
          if (calendar || item.time) row.append(time, content);
          else { row.classList.add('ahead-no-time'); row.appendChild(content); }
          if (!calendar) row.appendChild(taskActions(item.id || decodeURIComponent(String(item.url || '').split('/').pop()), item.title, row));
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
  return panelLoad('getFinanceDashboard', 'money-panel', (result) => {
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

function loadRecentLogs(panelId) {
  const id = panelId || 'recent-logs';
  const list = $(id);
  if (!list) return;
  return panelLoad('getRecentInboxLogs', id, (rows) => {
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

/* Recent meds: straight from Health tracker › Events via the receiver (HealthLog v11), last 7 days, newest first. */
function renderRecentMeds(stamp) {
  const list = $('medications');
  if (!list) return;
  const rows = cfg.recentMeds;
  list.replaceChildren();
  if (!Array.isArray(rows)) { list.textContent = stamp || 'Recent meds needs the HealthLog v11 update on the receiver.'; return; }
  if (!rows.length) list.textContent = 'No medication logged in the last 7 days.';
  rows.forEach((e) => {
    const row = document.createElement('div'); row.className = 'medication-row';
    const name = document.createElement('div'); name.className = 'medication-name'; name.textContent = e.name + (e.dose ? ' · ' + e.dose : '');
    const time = document.createElement('div'); time.className = 'medication-time'; time.textContent = e.when;
    row.append(name, time); list.appendChild(row);
  });
  if (stamp && rows.length) { const p = document.createElement('p'); p.className = 'panel-stamp'; p.textContent = stamp; list.appendChild(p); }
}
async function loadExtras() {
  renderRecentMeds('Updating…');
  const ok = await logRefreshConfig();
  renderRecentMeds(ok ? '' : 'Couldn’t refresh (offline?) · showing the last copy');
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
function closeReward() {
  const id = $('reward').dataset.task;
  $('reward').hidden = true; $('reward').replaceChildren(); $('reward').dataset.task = '';
  if (id && pendingDone[id]) pendingDone[id].send();
}
document.addEventListener('click', (event) => {
  const reward = $('reward');
  if (!reward.hidden && !reward.contains(event.target) && !(event.target.id === 'test-celebration')) {
    event.preventDefault(); event.stopImmediatePropagation(); closeReward();
  }
}, true);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('reward').hidden) closeReward(); });
function celebrateCompletion(taskId) {
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
  $('reward').dataset.task = taskId || '';
  if (taskId) {
    const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'reward-undo'; undo.textContent = 'Undo';
    undo.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const p = pendingDone[taskId]; if (p) p.undo(); $('reward').dataset.task = ''; closeReward(); };
    card.appendChild(undo);
  }
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

/* ================= HEALTH view (internal key "trends") =================
   Symptom history from Health tracker › Events, via the receiver's "config" answer.
   v16: each health day (04:00 to 04:00) gets a day score = the mean of that day's readings for the chosen
   symptoms (HealthLog v10 sends the means; older versions only the daily peaks). Days are coloured against
   "your usual" = the median day score of the 28 days before. Flares are days Ru marks with the Flare button;
   days much worse than usual get a lighter ring. Read-only. */
const TREND_SYMS = [
  { k: 'p', name: 'Pain', color: '#2a78d6', dash: '' },
  { k: 's', name: 'Stiffness', color: '#1baf7a', dash: '6 3' },
  { k: 'f', name: 'Fatigue', color: '#d99200', dash: '2 3' },
  { k: 'g', name: 'Mental clarity', color: '#7a68e0', dash: '8 3 2 3', inv: true },  // stored in fog direction; shown as 10 − value
  { k: 'h', name: 'Headache', color: '#e0679a', dash: '1 4' }
];
/* Tuning: how far from usual counts as better / worse / much worse, and the evidence needed.
   Tested on 4–28 Oct: averaging pain, stiffness and fatigue hides single-symptom bad days (a fatigue day
   with pain lower than usual averages out), so a day is "worse" when any chosen symptom is well above its
   own usual, or the average is. Roughly 1 day in 5 comes out worse with these numbers. */
const USUAL_DAYS = 28, USUAL_MIN = 5, MIN_READINGS = 2;
const SYM_WORSE = 1.0, SYM_MUCH = 2.0, AVG_WORSE = 0.5, AVG_MUCH = 1.25, AVG_BETTER = -0.75;
const TR = { at: 0, loading: false, sel: null, ssel: null, med: LS.get('trends.med', null), calScroll: {}, tipEl: null, on: LS.get('trends.on', ['load']), inc: LS.get('trends.inc', ['p', 's', 'f']), days: {} };
// Brain fog and headache are off by default now; move anyone still on the old default.
if (TR.inc.length === 5 && ['p', 's', 'f', 'g', 'h'].every((k) => TR.inc.includes(k))) { TR.inc = ['p', 's', 'f']; LS.set('trends.inc', TR.inc); }
const incSyms = () => TREND_SYMS.filter((x) => TR.inc.includes(x.k));
const TRENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16h16"/><path d="m7.5 14.5 3.5-4 3 2.5 5-6"/></svg>';

function trendsEnter() {
  const el = $('trends-view');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' +
      '<button type="button" class="icon-btn" id="trends-refresh" aria-label="Refresh">' + REFRESH_SVG + '</button>' +
      '<button type="button" class="icon-btn" id="trends-settings" aria-label="Settings">' + GEAR + '</button></div></div>' +
      '<h1 class="page-title">Health</h1><div id="trends-body" aria-live="polite"></div>';
    $('trends-refresh').onclick = () => spin($('trends-refresh'), trendsLoad);
    $('trends-settings').onclick = () => openSettings();
    el.addEventListener('click', trendsClick);
    el.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && t !== TR.tipEl) showTip(t); });
    el.addEventListener('mouseout', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip(); });
  }
  trendsRender();
  if (Conn.canLog() && (!TR.at || Date.now() - TR.at > 120000)) trendsLoad();
}

async function trendsLoad() {
  if (TR.loading || !Conn.canLog()) return;
  TR.loading = true; TR.at = Date.now(); trendsRender();
  try { await logRefreshConfig(); } finally { TR.loading = false; trendsRender(); }
}

const median = (a) => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const symVal = (d, k) => (d.a && typeof d.a[k] === 'number' ? d.a[k] : d.a ? undefined : d[k]);
function trendsDays() {
  const sy = cfg.symptoms;
  if (!sy || !Array.isArray(sy.days) || !sy.startKey) return null;
  const today = sy.todayKey || addDays(sy.startKey, sy.days.length - 1);
  const localFlare = {};
  recent.forEach((r) => { if (r.kind === 'flare' && r.status !== 'failed' && r.hday) localFlare[r.hday] = true; });
  const list = sy.days.map((d, i) => {
    const key = addDays(sy.startKey, i);
    const have = incSyms().filter((x) => typeof symVal(d, x.k) === 'number');
    const load = have.length ? have.reduce((a, x) => a + symVal(d, x.k), 0) / have.length : null;
    const readings = d.c ? Math.max.apply(null, [0].concat(have.map((x) => d.c[x.k] || 0))) : (d.n || 0);
    return { key, d, load, scores: have.length, readings, enough: load !== null && readings >= MIN_READINGS, flag: !!(d.fl || localFlare[key]) };
  });
  const enoughDays = list.filter((x) => x.enough);
  const usualOf = (vals, all) => (vals.length >= USUAL_MIN ? median(vals) : all.length >= USUAL_MIN ? median(all) : null);
  const allScores = enoughDays.map((x) => x.load);
  const allSym = {};
  incSyms().forEach((sm) => { allSym[sm.k] = enoughDays.map((x) => symVal(x.d, sm.k)).filter((v) => typeof v === 'number'); });
  list.forEach((x, i) => {
    const prior = list.slice(Math.max(0, i - USUAL_DAYS), i).filter((y) => y.enough);
    x.usual = usualOf(prior.map((y) => y.load), allScores);
    // Each chosen symptom against its own usual.
    x.dev = {};
    incSyms().forEach((sm) => {
      const v = symVal(x.d, sm.k);
      const u = usualOf(prior.map((y) => symVal(y.d, sm.k)).filter((w) => typeof w === 'number'), allSym[sm.k]);
      if (typeof v === 'number' && u !== null) x.dev[sm.k] = v - u;
    });
    const devs = Object.values(x.dev);
    const avg = devs.length ? devs.reduce((t, v) => t + v, 0) / devs.length : null, max = devs.length ? Math.max.apply(null, devs) : null;
    x.cls = !x.enough || avg === null ? (x.load !== null ? 'thin' : 'none')
      : max >= SYM_MUCH || avg >= AVG_MUCH ? 'much' : max >= SYM_WORSE || avg >= AVG_WORSE ? 'worse' : avg <= AVG_BETTER && max < 0.5 ? 'better' : 'usual';
    x.flare = x.flag || x.cls === 'much';
  });
  const by = {};
  list.forEach((x) => { by[x.key] = x; });
  return { list, by, today, marks: Array.isArray(sy.marks) ? sy.marks : [], means: list.some((x) => x.d.a) };
}
/* Flare episodes: days you marked, joined with the worse days either side; "possible" = runs of much-worse days you didn't mark. */
function flareEpisodes(list) {
  const eps = [];
  let cur = null;
  list.forEach((x, i) => {
    const bad = x.flag || x.cls === 'much' || (cur && (x.cls === 'worse'));
    if (bad) {
      if (!cur) {
        cur = { from: x.key, to: x.key, marked: x.flag, days: 1 };
        // pull in worse days just before a marked day
        for (let j = i - 1; j >= 0 && (list[j].cls === 'worse' || list[j].cls === 'much') && (!eps.length || list[j].key > eps[eps.length - 1].to); j--) { cur.from = list[j].key; cur.days++; }
      } else { cur.to = x.key; cur.days++; cur.marked = cur.marked || x.flag; }
    } else if (cur) { eps.push(cur); cur = null; }
  });
  if (cur) eps.push(cur);
  return eps.filter((e) => e.marked || list.some((x) => x.key >= e.from && x.key <= e.to && x.cls === 'much'));
}
const rangeText = (e) => { const a = keyToDate(e.from), b = keyToDate(e.to); const f = (d, m) => d.toLocaleDateString('en-GB', m ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
  return e.from === e.to ? f(a, true) : f(a, a.getMonth() !== b.getMonth()) + ' – ' + f(b, true); };

const heatLevel = (l) => (l < 4.5 ? 0 : l < 5.5 ? 1 : l < 6.2 ? 2 : l < 7 ? 3 : 4);
const shortDate = (k) => keyToDate(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const longDate = (k) => keyToDate(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const avgLoad = (xs) => { const v = xs.filter((x) => x.load !== null); return v.length ? v.reduce((a, x) => a + x.load, 0) / v.length : null; };

/* Scrollable calendar: every Monday-start week from the first day with data to this week. About six weeks
   show at a time; it opens on the latest week and remembers where you scrolled. cell(k) returns one day's HTML. */
function calGrid(key, label, firstKey, today, cell) {
  const end = addDays(today, 6 - ((keyToDate(today).getDay() + 6) % 7));
  let start = firstKey ? addDays(firstKey, -((keyToDate(firstKey).getDay() + 6) % 7)) : end;
  if (start > addDays(end, -41)) start = addDays(end, -41);
  const weeks = Math.round((keyToDate(end) - keyToDate(start)) / 86400000 + 1) / 7;
  let html = '<div class="tr-cal tr-cal-head" aria-hidden="true">' + ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'].map((t) => '<span class="tr-dh">' + t + '</span>').join('') + '</div>' +
    '<div class="tr-cal-scroll" data-cal="' + key + '" role="grid" aria-label="' + esc(label) + '"><div class="tr-cal">';
  for (let w = 0; w < Math.round(weeks); w++) {
    const ws = addDays(start, w * 7);
    html += '<span class="tr-wk">' + esc(shortDate(ws)) + '</span>';
    for (let i = 0; i < 7; i++) {
      const k = addDays(ws, i);
      html += k > today ? '<span class="tr-cell future"></span>' : cell(k);
    }
  }
  return html + '</div></div>';
}
function restoreCalScroll(root) {
  TR.calScroll = TR.calScroll || {};
  root.querySelectorAll('.tr-cal-scroll').forEach((el) => {
    const k = el.dataset.cal;
    el.scrollTop = TR.calScroll[k] !== undefined ? TR.calScroll[k] : el.scrollHeight;
    el.addEventListener('scroll', () => { TR.calScroll[k] = el.scrollTop; hideTip(); }, { passive: true });
  });
}
/* Info box for chart readings: hover on a computer, tap on the phone. Elements carry data-tip. */
function showTip(el) {
  let t = $('tr-tip');
  if (!t) { t = document.createElement('div'); t.id = 'tr-tip'; t.className = 'tr-tip'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = el.getAttribute('data-tip');
  t.hidden = false;
  const r = el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
  const top = r.top - th - 8 < 8 ? r.bottom + 8 : r.top - th - 8;
  t.style.left = left + 'px'; t.style.top = top + 'px';
  if (TR.tipEl && TR.tipEl !== el && TR.tipEl.classList) TR.tipEl.classList.remove('on');
  if (el.classList) el.classList.add('on');
  TR.tipEl = el;
}
function hideTip() { const t = $('tr-tip'); if (t) t.hidden = true; if (TR.tipEl && TR.tipEl.classList) TR.tipEl.classList.remove('on'); TR.tipEl = null; }
window.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('click', (e) => { if (TR.tipEl && !(e.target.closest && e.target.closest('[data-tip]'))) hideTip(); });

function trendsRender() {
  const body = $('trends-body');
  if (!body) return;
  const T2 = trendsDays();
  if (!T2) {
    if (!Conn.canLog()) body.innerHTML = '<div class="notice">Pair this device once to see your health trends.<button type="button" class="log wide" data-tr="pair">Pair this device</button></div>';
    else if (TR.loading) body.innerHTML = '<p class="small tr-center">Loading your check-ins…</p>';
    else body.innerHTML = '<div class="notice">This page needs the receiver update (HealthLog v6). Once it’s deployed, this page fills in by itself.</div>';
    return;
  }
  const { list, by, today } = T2;
  const last = (n, end) => list.filter((x) => x.key <= addDays(today, -end) && x.key > addDays(today, -end - n));
  const l28 = last(28, 0);
  const rough = l28.filter((x) => x.cls === 'worse' || x.cls === 'much').length;
  const eps = flareEpisodes(list).filter((e) => e.to > addDays(today, -28));
  const possible = eps.filter((e) => !e.marked);
  const wkDiff = (() => { const v = last(7, 0).filter((x) => x.enough && x.usual !== null); return v.length ? v.reduce((t, x) => t + x.load - x.usual, 0) / v.length : null; })();
  let html = '<div class="tr-stats">' +
    '<div class="tr-stat"><span>Rough days</span><b>' + rough + '</b><small>last 4 weeks</small></div>' +
    '<div class="tr-stat"><span>Flares</span><b>' + eps.length + '</b><small>' + (possible.length ? 'from your scores' : 'last 4 weeks') + '</small></div>' +
    '<div class="tr-stat"><span>This week</span><b>' + (wkDiff === null ? '–' : Math.abs(wkDiff) < 0.25 ? 'Usual' : (wkDiff > 0 ? '+' : '−') + Math.abs(wkDiff).toFixed(1)) + '</b><small>' + (wkDiff !== null && Math.abs(wkDiff) < 0.25 ? 'about your usual' : 'vs your usual') + '</small></div></div>';
  if (eps.length) html += '<div class="tr-eps">' + eps.slice(-3).reverse().map((e) => '<div class="tr-ep' + (e.marked ? '' : ' possible') + '"><i></i>' + esc(rangeText(e)) + ' · ' + e.days + (e.days === 1 ? ' day' : ' days') + (e.marked ? '' : ' · from your scores') + '</div>').join('') + '</div>';

  html += '<div class="tr-inc"><span>Day score uses</span>' + TREND_SYMS.map((x) => '<button type="button" class="tr-chip" data-tr="inc" data-v="' + x.k + '" aria-pressed="' + TR.inc.includes(x.k) + '">' + esc(x.name) + '</button>').join('') + '</div>';
  // Calendar: scrollable, opens on the latest weeks.
  const CLS = { better: 'hb', usual: 'h1', worse: 'h3', much: 'h4', thin: 'thin' };
  const WORD = { better: 'better than usual', usual: 'about usual', worse: 'worse than usual', much: 'much worse than usual', thin: 'only one reading' };
  const firstData = (list.find((x) => x.load !== null || x.flag) || {}).key;
  html += calGrid('health', 'Symptom calendar', firstData, today, (k) => {
    const x = by[k], n = keyToDate(k).getDate();
    const cls = ['tr-cell'];
    if (k === today) cls.push('today');
    if (k === TR.sel) cls.push('sel');
    const mark = x && x.flag ? '<i class="tr-flare"></i>' : x && x.cls === 'much' ? '<i class="tr-flare ring"></i>' : '';
    if (x && x.cls !== 'none') {
      cls.push(CLS[x.cls] || 'h1');
      return '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + ', ' + WORD[x.cls] + (x.flag ? ', flare' : '') + '">' + n + mark + '</button>';
    }
    cls.push('empty');
    return '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + (x && x.flag ? ', flare' : ', no check-in') + '">' + n + mark + '</button>';
  });
  html += '<div class="tr-key"><span class="tr-kc"><i class="hb"></i>Better</span><span class="tr-kc"><i class="h1"></i>Usual</span><span class="tr-kc"><i class="h3"></i>Worse</span><span class="tr-kc"><i class="h4"></i>Much worse</span>' +
    '<span><i class="tr-flare inline ring"></i>Flare (from your scores)</span>' + (list.some((x) => x.flag) ? '<span><i class="tr-flare inline"></i>Flare (noted)</span>' : '') + '</div>';

  // Detail for the chosen day, with its 24-hour strip.
  const sel = TR.sel && TR.sel <= today ? TR.sel : null;
  if (sel) {
    const x = by[sel];
    const vals = x ? TREND_SYMS.filter((sm) => typeof symVal(x.d, sm.k) === 'number').map((sm) => sm.name.toLowerCase() + ' ' + (sm.inv ? Math.round((10 - symVal(x.d, sm.k)) * 10) / 10 : symVal(x.d, sm.k))) : [];
    html += '<p class="tr-detail"><b>' + esc(longDate(sel)) + '</b> · ' + (x && x.load !== null
      ? 'day score ' + x.load.toFixed(1) + (x.usual !== null ? ' (usual ' + x.usual.toFixed(1) + ')' : '') + (x.flag ? ' · flare noted' : '') + ' · ' + vals.join(', ') +
        (Object.keys(x.dev || {}).filter((kk) => x.dev[kk] >= SYM_WORSE).length ? ' · above usual: ' + Object.keys(x.dev).filter((kk) => x.dev[kk] >= SYM_WORSE).map((kk) => { const t = TREND_SYMS.find((y) => y.k === kk); return t.name.toLowerCase() + (t.inv ? ' −' : ' +') + x.dev[kk].toFixed(1); }).join(', ') : '') +
        (x.readings ? ' · ' + x.readings + (x.readings === 1 ? ' reading' : ' readings') : '') + (T2.means ? '' : ' · daily highs')
      : (x && x.flag ? 'flare noted · ' : '') + (sel === today ? 'no check-in yet today' : 'no check-in logged')) + '</p>' + dayStrip(sel);
  } else html += '<p class="tr-detail muted">Tap a day for its scores and a 24-hour view.</p>';

  // Chart chips + chart.
  const series = [{ k: 'load', name: 'Overall' }].concat(TREND_SYMS);
  html += '<div class="tr-chips">' + series.map((s) => '<button type="button" class="tr-chip" data-tr="series" data-v="' + s.k + '" aria-pressed="' + TR.on.includes(s.k) + '">' +
    '<i style="' + (s.k === 'load' ? 'background:var(--ink)' : 'background:' + s.color) + '"></i>' + esc(s.name) + '</button>').join('') + '</div>';
  html += trendsChart(T2) + (T2.list.some((x) => x.d.al) ? patBtn('activity', 'Activity patterns') : '');
  html += momentsHealth(T2, today) + stomachView(T2) + medsView(today) + (planSteps().length ? '<h2 class="tr-h" id="trials">Trials</h2>' + planHtml(today, true) : '') + sleepView(T2);
  html += '<p class="tr-foot">Day score = the average of that day’s readings for the symptoms you choose (days with ' + MIN_READINGS + '+ readings are coloured). Colours compare each day with your usual (the middle value of the ' + USUAL_DAYS + ' days before): worse means a chosen symptom was a point or more above its usual, or the average half a point. A ring marks a day much worse than usual; runs of those (with the worse days around them) show as flares. Days run 04:00 to 04:00.</p>' +
    fileLinks([['Health tracker', LINKS.healthSheet]]);
  if (TR.pop) {
    const G = giData();
    const pop = TR.pop === 'stomach' ? (G ? stomachPatterns(G, today) : null) : TR.pop === 'activity' ? activityPatterns(T2) : TR.pop === 'sleep' ? sleepPatterns(T2) : TR.pop === 'steps' ? stepsCompare(T2, today) : null;
    html += patternsPopup(pop);
    TR.popFresh = false;
  }
  document.body.classList.toggle('sheet-open', !!TR.pop || !!S.sheet);
  hideTip();
  body.innerHTML = html;
  restoreCalScroll(body);
}

function trendsChart(T2) {
  const { marks } = T2;
  // Start the chart at the first logged day (at least the last 14 days) so empty weeks don't squash it.
  const recent42 = T2.list.slice(-42);
  const firstData = recent42.findIndex((x) => x.load !== null);
  const list = recent42.slice(Math.max(0, Math.min(firstData < 0 ? 0 : firstData, recent42.length - 14)));
  const hasAct = list.some((x) => x.d.al);
  const BAND = hasAct ? 30 : 0;
  const W = 360, H = 190 + BAND, L = 22, R = 8, TOP = 16, B = 22 + BAND;
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
    const get = (x) => { const v = symVal(x.d, s.k); return s.inv && typeof v === 'number' ? 10 - v : v; };
    svg += '<path d="' + path(get) + '" fill="none" stroke="' + s.color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>' +
      dots(get, '').replace(/class=""/g, 'fill="' + s.color + '"');
  });
  if (TR.on.includes('load')) {
    const get = (x) => x.load;
    svg += '<path d="' + path(get) + '" fill="none" class="tr-load"/>' + dots(get, 'tr-loaddot');
    list.forEach((x, i) => { if (x.flare && x.load !== null) svg += '<circle cx="' + X(i) + '" cy="' + Y(x.load) + '" r="3.6" class="tr-flaredot' + (x.flag ? '' : ' ring') + '"/>'; });
  }
  // Activity load as thin bars under the chart, on the same days.
  if (hasAct) {
    const max = Math.max.apply(null, list.map((x) => x.d.al || 0));
    const top = TOP + ch + 8, hgt = BAND - 10, bwid = Math.max(2, Math.min(8, (cw / Math.max(1, n - 1)) * 0.6));
    svg += '<text x="' + (L - 5) + '" y="' + (top + hgt - 2) + '" class="tr-ax" text-anchor="end">act</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + (top + hgt) + '" y2="' + (top + hgt) + '" class="tr-grid"/>';
    list.forEach((x, i) => {
      if (!x.d.al) return;
      const h = Math.max(1.5, (x.d.al / max) * hgt);
      svg += '<rect x="' + (X(i) - bwid / 2).toFixed(1) + '" y="' + (top + hgt - h).toFixed(1) + '" width="' + bwid.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1" class="tr-actbar"><title>' + esc(longDate(x.key)) + ': ' + x.d.am + ' min active</title></rect>';
    });
  }
  return svg + '</svg>';
}

/* ---------- Patterns pop-up: each section's comparisons as side-by-side numbers ---------- */
const mean1 = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
const patBtn = (key, label) => '<button type="button" class="pt-btn" data-tr="pat" data-v="' + key + '" aria-haspopup="dialog">' + esc(label) + '<span aria-hidden="true">›</span></button>';
/* Verdict for "after A vs after B" on the day score (higher = heavier day). */
function nextDayVerdict(a, b, bName) {
  if (a === null || b === null) return { text: '', tone: '' };
  const d = b - a;
  if (Math.abs(d) < 0.4) return { text: 'No clear difference yet', tone: 'same' };
  return d > 0 ? { text: 'Heavier days after ' + bName, tone: 'worse' } : { text: 'Lighter days after ' + bName, tone: 'better' };
}
/* Activity: busiest vs quiet days, fatigue 1 and 2 days later. */
function activityPatterns(T2) {
  const list = T2.list;
  if (!list.some((x) => x.d.al)) return null;
  const fat = (x) => (x ? symVal(x.d, 'f') : undefined);
  const idx = {}; list.forEach((x, i) => { idx[x.key] = i; });
  const active = list.filter((x) => x.d.al).sort((a, b) => b.d.al - a.d.al).slice(0, 5);
  const quiet = list.filter((x) => !x.d.al && x.load !== null).slice(-5);
  const after = (days, lag) => { const v = days.map((x) => fat(list[idx[x.key] + lag])).filter((y) => typeof y === 'number'); return v.length ? { m: mean1(v), n: v.length } : null; };
  const week = list.slice(-7).reduce((t, x) => t + (x.d.am || 0), 0);
  const p = { title: 'Activity patterns', stats: [{ label: 'Active, last 7 days', value: week + ' min' }], comps: [] };
  [[1, 'Fatigue the next day'], [2, 'Fatigue two days later']].forEach(([lag, title]) => {
    const a = after(active, lag), q = after(quiet, lag);
    if (!a || !q || a.n < 3 || q.n < 3) return;
    const d = a.m - q.m;
    p.comps.push({ title, left: { label: 'After quiet days', value: q.m.toFixed(1), sub: q.n + ' days' }, right: { label: 'After your busiest days', value: a.m.toFixed(1), sub: a.n + ' days' },
      verdict: Math.abs(d) < 0.4 ? 'No clear difference yet' : d > 0 ? 'More tired after busy days' : 'Less tired after busy days', tone: Math.abs(d) < 0.4 ? 'same' : d > 0 ? 'worse' : 'better' });
  });
  if (!p.comps.length) p.empty = 'A few more logged days and this will compare busy and quiet days with fatigue afterwards.';
  p.note = 'Busiest = the 5 days with the most activity (minutes × effort). Quiet = recent days with none logged.';
  return p;
}
function patternsHtml(p) {
  const cell = (x) => '<div class="pt-cell"><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</div>';
  let h = '';
  if (p.stats && p.stats.length) h += '<div class="pt-stats">' + p.stats.map(cell).join('') + '</div>';
  (p.comps || []).forEach((c) => {
    h += '<div class="pt"><div class="pt-h">' + esc(c.title) + '</div><div class="pt-row">' + cell(c.left) + cell(c.right) + '</div>' +
      (c.verdict ? '<div class="pt-v ' + (c.tone || '') + '">' + esc(c.verdict) + '</div>' : '') + '</div>';
  });
  if (p.html) h += p.html;
  if (p.empty) h += '<p class="small">' + esc(p.empty) + '</p>';
  if (p.note) h += '<p class="pt-note">' + esc(p.note) + '</p>';
  return h;
}
function patternsPopup(p) {
  if (!p) return '';
  return '<div class="sheet-backdrop' + (TR.popFresh ? ' fresh' : '') + '" data-tr="pat-close"></div>' +
    '<div class="sheet' + (TR.popFresh ? ' fresh' : '') + '" id="tr-sheet" role="dialog" aria-modal="true" aria-labelledby="tr-sheet-title">' +
    '<div class="sheet-grab" aria-hidden="true"></div><div class="sheet-head"><h2 id="tr-sheet-title">' + esc(p.title) + '</h2>' +
    '<button type="button" class="icon-btn sheet-x" data-tr="pat-close" aria-label="Close">' + X_SVG + '</button></div>' + patternsHtml(p) + '</div>';
}
function closePatterns() { if (!TR.pop) return; TR.pop = null; trendsRender(); }

/* 24-hour strip for a chosen day (04:00 → 04:00): activity spans, check-in scores (chosen symptoms) as dots,
   food and bowel as ticks. Uses the receiver's "day" answer (activity/checks need HealthLog v10). */
function dayStrip(k) {
  const det = TR.days[k];
  if (!det) { loadDayDetail(k); return '<p class="small">Loading the day…</p>'; }
  if (det.error) return '<p class="small">' + esc(det.error) + '</p>';
  const W = 360, L = 8, R = 8, cw = W - L - R, H = 104;
  const mins = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return null; let v = Number(m[1]) * 60 + Number(m[2]) - 240; return v < 0 ? v + 1440 : v; };
  const X = (v) => L + (v / 1440) * cw;
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(longDate(k)) + ' hour by hour">';
  [0, 240, 480, 720, 960, 1200, 1440].forEach((v) => {
    svg += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="4" y2="' + (H - 14) + '" class="tr-bedline"/>' +
      '<text x="' + X(v) + '" y="' + (H - 2) + '" class="tr-ax" text-anchor="' + (v === 0 ? 'start' : v === 1440 ? 'end' : 'middle') + '">' + pad(((v / 60) + 4) % 24) + ':00</text>';
  });
  (det.activity || []).forEach((a) => {
    const s0 = mins(a.time); if (s0 === null) return;
    svg += '<rect x="' + X(s0).toFixed(1) + '" y="6" width="' + Math.max(2, X(Math.min(1440, s0 + a.min)) - X(s0)).toFixed(1) + '" height="12" rx="2" class="tr-actspan w' + (a.w || 2) + '"><title>' + esc(a.time + ' · ' + a.text + ' · ' + a.min + ' min') + '</title></rect>';
  });
  const top = 26, bot = 70;
  svg += '<text x="' + (L + 1) + '" y="' + (top + 7) + '" class="tr-ax">10</text>';
  (det.checks || []).forEach((c) => {
    const t = mins(c.time); if (t === null) return;
    if (c.flare) { svg += '<circle cx="' + X(t).toFixed(1) + '" cy="' + top + '" r="4" class="tr-flaredot"><title>' + esc(c.time) + ' flare</title></circle>'; return; }
    const v = incSyms().map((x) => c.s[x.k]).filter((y) => typeof y === 'number');
    if (!v.length) return;
    const m = v.reduce((a, y) => a + y, 0) / v.length;
    svg += '<circle cx="' + X(t).toFixed(1) + '" cy="' + (bot - (m / 10) * (bot - top)).toFixed(1) + '" r="3.5" class="tr-loaddot"><title>' + esc(c.time + ' · ' + m.toFixed(1)) + '</title></circle>';
  });
  const ticks = (items, cls, y) => (items || []).forEach((x) => { const t = mins(x.time); if (t !== null) svg += '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + y + '" y2="' + (y + 9) + '" class="' + cls + '"><title>' + esc(x.time + ' · ' + x.text) + '</title></line>'; });
  ticks(det.meals, 'tr-tick food', 76);
  ticks(det.bowel, 'tr-tick bowel', 76);
  (det.moments || []).forEach((x) => { const t = mins(x.time); if (t !== null) svg += '<path d="M' + X(t).toFixed(1) + ' ' + (top - 8) + 'l4 6h-8z" class="tr-moment ' + (x.text === 'Weak' ? 'weak' : x.text === 'Very tired' ? 'vtired' : 'tired') + '"><title>' + esc(x.time + ' · ' + x.text + (x.note ? ' · ' + x.note : '')) + '</title></path>'; });
  svg += '</svg>';
  const has = (det.activity || []).length || (det.checks || []).length || (det.meals || []).length || (det.bowel || []).length;
  return svg + '<div class="tr-key"><span><i class="tr-kbar"></i>Activity</span><span><i class="tr-kdot"></i>Check-in (chosen symptoms)</span><span><i class="tr-ktick food"></i>Food</span><span><i class="tr-ktick bowel"></i>Bowel</span>' + ((det.moments || []).length ? '<span><i class="tr-kmo"></i>Moment</span>' : '') + '</div>' +
    (has ? '' : '<p class="small">Nothing with a clock time logged that day.</p>') + ((det.activity === undefined) ? '<p class="small">Activity and check-in times need the HealthLog v10 update.</p>' : '');
}

/* Moments (tired / very tired / weak), from 29 Oct: dots per day for the last six weeks. */
function momentsHealth(T2, today) {
  const n = 42, first0 = addDays(today, -(n - 1));
  const any = T2.list.some((x) => x.d.mt || x.d.mv || x.d.mw);
  let html = '<h2 class="tr-h">Moments</h2>';
  if (!any) return html + '<p class="small tr-hint">Tired, very tired and weak moments from the Log tab show here. Tracking since ' + esc(longDate(MOMENTS_SINCE)) + '.</p>';
  const W = 360, L = 58, R = 4, rowH = 13, gap = 4, top = 4, H = top + 2 * (rowH + gap) + 12;
  const bw = (W - L - R) / n;
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tired and weak moments, last six weeks">';
  ['Tired', 'Weak'].forEach((name, r) => { svg += '<text x="' + (L - 6) + '" y="' + (top + r * (rowH + gap) + rowH - 3) + '" class="tr-ax" text-anchor="end">' + name + '</text>'; });
  for (let i = 0; i < n; i++) {
    const k = addDays(first0, i), x = T2.by[k];
    const cx = L + i * bw + bw / 2;
    if (k < MOMENTS_SINCE) continue;
    const d = x ? x.d : {};
    const tired = (d.mt || 0) + (d.mv || 0), weak = d.mw || 0;
    if (tired) svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + (top + rowH / 2) + '" r="' + Math.min(6, 2.5 + tired) + '" class="tr-mo ' + (d.mv ? 'vtired' : 'tired') + '"/>';
    if (weak) svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + (top + rowH + gap + rowH / 2) + '" r="' + Math.min(6, 2.5 + weak) + '" class="tr-mo weak"/>';
    if (tired || weak) svg += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (top + 2 * (rowH + gap)) + '" class="tr-hit" data-tip="' + esc(longDate(k) + ' · ' + [d.mt ? d.mt + ' tired' : '', d.mv ? d.mv + ' very tired' : '', weak ? weak + ' weak' : ''].filter(Boolean).join(', ')) + '"/>';
  }
  svg += '<text x="' + L + '" y="' + (H - 1) + '" class="tr-ax">' + esc(shortDate(first0)) + '</text><text x="' + (W - R) + '" y="' + (H - 1) + '" class="tr-ax" text-anchor="end">' + esc(shortDate(today)) + '</text></svg>';
  return html + svg + '<p class="small tr-hint">Bigger dot = more that day; darker = very tired. Tracking since ' + esc(longDate(MOMENTS_SINCE)) + '; not part of day scores.</p>';
}
/* ---------- Stomach: average stomach pain each day, omeprazole days, tap for food; then stomach through the day ---------- */
const stomachLevel = (v) => (v < 1 ? 0 : v < 2.5 ? 1 : v < 4 ? 2 : v < 6 ? 3 : 4);
/* Bowel marker in the corner: loose (Bristol 6–7) wins over hard (1–2) if both happened. */
function bowelKind(bx) {
  if (!Array.isArray(bx) || !bx.length) return '';
  return bx.some((t) => t >= 6) ? 'loose' : bx.some((t) => t <= 2) ? 'hard' : '';
}
const bowelMark = (bx) => (bowelKind(bx) ? '<i class="tr-bm ' + bowelKind(bx) + '"></i>' : '');
const bowelLabel = (bx) => (Array.isArray(bx) && bx.length ? ', Bristol ' + bx.join(', ') : '');
function omeprazoleDays() {
  const h = cfg.history, out = {};
  const m = h && Array.isArray(h.meds) ? h.meds.find((x) => /omeprazole/i.test(x.name)) : null;
  if (m) (m.counts || []).forEach((n, i) => { if (n) out[addDays(h.startKey, i)] = true; });
  return out;
}
/* Stomach pain through the day (HealthLog v9): per day [average, morning, afternoon, evening, night, woke with pain 1/0]. */
function giData() {
  const g = cfg.symptoms && cfg.symptoms.gi;
  if (!g || !Array.isArray(g.days) || !g.startKey) return null;
  const by = {};
  g.days.forEach((d, i) => { by[addDays(g.startKey, i)] = d; });
  return { by, omeStart: g.omeStart || '' };
}
const giNum = (v) => typeof v === 'number';
const GI_PARTS = ['Morning', 'Afternoon', 'Evening', 'Night'];
function dayPartsView(G, today) {
  const n = 42, W = 360, L = 58, R = 4, rowH = 13, gap = 3, top = 4;
  const bw = (W - L - R) / n, H = top + 4 * (rowH + gap) + 12;
  const first = addDays(today, -(n - 1));
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Stomach pain by time of day, last six weeks">';
  GI_PARTS.forEach((name, r) => {
    svg += '<text x="' + (L - 6) + '" y="' + (top + r * (rowH + gap) + rowH - 3) + '" class="tr-ax" text-anchor="end">' + name + '</text>';
  });
  for (let i = 0; i < n; i++) {
    const k = addDays(first, i), d = G.by[k];
    if (!d) continue;
    for (let r = 0; r < 4; r++) {
      let v = d[r + 1], cls = '', label = '';
      if (giNum(v)) { cls = 's' + stomachLevel(v); label = GI_PARTS[r].toLowerCase() + ' stomach pain ' + v; }
      else if (r === 0 && d[5] === 0) { cls = 's0'; label = 'no stomach pain on waking'; }
      if (!cls) continue;
      svg += '<rect x="' + (L + i * bw + 0.5).toFixed(1) + '" y="' + (top + r * (rowH + gap)) + '" width="' + Math.max(1.5, bw - 1).toFixed(1) + '" height="' + rowH + '" rx="1.5" class="tr-part ' + cls + '"/>';
    }
  }
  // Invisible columns on top: hover or tap shows that day's readings.
  for (let i = 0; i < n; i++) {
    const k = addDays(first, i), d = G.by[k];
    if (!d) continue;
    const bits = GI_PARTS.map((name, r) => (giNum(d[r + 1]) ? name.toLowerCase() + ' ' + d[r + 1] : '')).filter(Boolean);
    if (!giNum(d[1]) && d[5] === 0) bits.unshift('no pain on waking');
    if (d[6] === 1) bits.push('probiotic');
    if (!bits.length) continue;
    svg += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (top + 4 * (rowH + gap)) + '" class="tr-hit" data-tip="' + esc(longDate(k) + ' · ' + bits.join(' · ')) + '"/>';
  }
  if (G.omeStart && G.omeStart > first && G.omeStart <= today) {
    const x = L + Math.round((keyToDate(G.omeStart) - keyToDate(first)) / 86400000) * bw;
    svg += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="1" y2="' + (H - 11) + '" class="tr-omeline"/>';
  }
  svg += '<text x="' + L + '" y="' + (H - 1) + '" class="tr-ax">' + esc(shortDate(first)) + '</text><text x="' + (W - R) + '" y="' + (H - 1) + '" class="tr-ax" text-anchor="end">' + esc(shortDate(today)) + '</text></svg>';
  return '<div class="tr-sub">Through the day</div>' + svg +
    '<div class="tr-key"><span><i class="tr-omeline-key"></i>Omeprazole started</span><span>Tap a day for its readings</span></div>' +
    patBtn('stomach', 'Stomach patterns');
}
/* Stomach patterns: mornings before vs since omeprazole, and probiotic (before vs since, and days taken vs not). */
const PAINFUL_AT = 4;
function stomachPatterns(G, today) {
  const p = { title: 'Stomach patterns', comps: [], note: 'Morning = waking to about 1pm. A morning counts as painful at ' + PAINFUL_AT + ' or more, or when a note says you woke with stomach pain. Only logged mornings count.' };
  const keys = Object.keys(G.by).filter((k) => k <= today).sort();
  const tone = (d, small) => (Math.abs(d) < small ? 'same' : d < 0 ? 'better' : 'worse');
  const avgComp = (title, a, b, aLabel, bLabel) => {
    const ma = mean1(a), mb = mean1(b);
    if (a.length < 3 || b.length < 3) return false;
    const d = mb - ma;
    p.comps.push({ title, left: { label: aLabel, value: ma.toFixed(1), sub: a.length + ' mornings' }, right: { label: bLabel, value: mb.toFixed(1), sub: b.length + ' mornings' },
      verdict: Math.abs(d) < 0.5 ? 'About the same' : d < 0 ? 'Lower with it' : 'Higher with it', tone: tone(d, 0.5) });
    return true;
  };
  if (G.omeStart) {
    const S = { b: { n: 0, pain: 0, sc: [], rest: [] }, a: { n: 0, pain: 0, sc: [], rest: [] } };
    keys.forEach((k) => {
      const d = G.by[k], s = S[k < G.omeStart ? 'b' : 'a'];
      if (giNum(d[1]) || d[5] === 1 || d[5] === 0) { s.n++; if ((giNum(d[1]) && d[1] >= PAINFUL_AT) || (!giNum(d[1]) && d[5] === 1)) s.pain++; }
      if (giNum(d[1])) s.sc.push(d[1]);
      const rest = [d[2], d[3], d[4]].filter(giNum);
      if (rest.length) s.rest.push(mean1(rest));
    });
    if (S.b.n >= 3 && S.a.n >= 3) {
      const since = 'Since ' + shortDate(G.omeStart);
      const pct = (s) => Math.round((100 * s.pain) / s.n);
      const dp = pct(S.a) - pct(S.b);
      p.comps.push({ title: 'Omeprazole: mornings with stomach pain', left: { label: 'Before omeprazole', value: S.b.pain + ' of ' + S.b.n, sub: pct(S.b) + '%' }, right: { label: since, value: S.a.pain + ' of ' + S.a.n, sub: pct(S.a) + '%' },
        verdict: Math.abs(dp) < 10 ? 'About the same' : dp < 0 ? 'Fewer painful mornings since' : 'More painful mornings since', tone: tone(dp, 10) });
      const mb = mean1(S.b.sc), ma = mean1(S.a.sc);
      if (mb !== null && ma !== null) {
        const d = ma - mb;
        p.comps.push({ title: 'Omeprazole: morning stomach pain, average', left: { label: 'Before', value: mb.toFixed(1) }, right: { label: since, value: ma.toFixed(1) },
          verdict: Math.abs(d) < 0.5 ? 'About the same' : d < 0 ? 'Lower since' : 'Higher since', tone: tone(d, 0.5) });
      }
      const rb = mean1(S.b.rest), ra = mean1(S.a.rest);
      if (rb !== null && ra !== null) {
        const d = ra - rb;
        p.comps.push({ title: 'Omeprazole: rest of the day (afternoon to night)', left: { label: 'Before', value: rb.toFixed(1) }, right: { label: since, value: ra.toFixed(1) },
          verdict: Math.abs(d) < 0.5 ? 'About the same' : d < 0 ? 'Lower since' : 'Higher since', tone: tone(d, 0.5) });
      }
    } else p.comps.push({ title: 'Omeprazole', left: { label: 'Started', value: shortDate(G.omeStart) }, right: { label: 'Logged mornings', value: S.b.n + ' before · ' + S.a.n + ' since' }, verdict: 'Not enough mornings to compare yet', tone: 'same' });
  }
  // Probiotic: before vs since the current run, then the morning after a probiotic day vs a day without one logged.
  if (G.proStart || G.proFirst) {
    const start = G.proStart || G.proFirst;
    const before = [], since = [];
    keys.forEach((k) => { const v = G.by[k][1]; if (giNum(v)) (k < start ? before : since).push(v); });
    avgComp('Probiotic: morning stomach pain, before vs since ' + shortDate(start), before, since, 'Before', 'Since ' + shortDate(start));
    const after = [], without = [];
    keys.forEach((k, i) => {
      if (k < (G.proFirst || start) || i + 1 >= keys.length) return;
      const next = G.by[keys[i + 1]][1];
      if (!giNum(next)) return;
      (G.by[k][6] === 1 ? after : without).push(next);
    });
    if (!avgComp('Probiotic: next morning, after a day with vs without it', without, after, 'Without (not logged)', 'After a probiotic day')) {
      p.comps.push({ title: 'Probiotic: next morning, with vs without', left: { label: 'After probiotic days', value: String(after.length), sub: 'mornings' }, right: { label: 'After days without', value: String(without.length), sub: 'mornings' }, verdict: 'Not enough days without it to compare yet', tone: 'same' });
    }
    if (G.omeStart && Math.abs((keyToDate(start) - keyToDate(G.omeStart)) / 86400000) < 21) p.note += ' Probiotic and omeprazole started close together, so their effects overlap.';
  }
  if (!p.comps.length) p.empty = 'Once omeprazole or the probiotic is logged, this compares mornings before and since.';
  return p;
}
function stomachView(T2) {
  const { by, today } = T2;
  const ome = omeprazoleDays();
  const G = giData();
  // Colour: the day's average stomach pain (HealthLog v9); before that update, the highest stomach or bloating score.
  const dayScore = (k, d) => {
    const g = G && G.by[k];
    if (g && giNum(g[0])) return g[0];
    const v = [d.st, d.b].filter(giNum);
    return v.length ? Math.max.apply(null, v) : null;
  };
  const firstData = (T2.list.find((x) => dayScore(x.key, x.d) !== null) || {}).key;
  let html = '<h2 class="tr-h">Stomach</h2>' + calGrid('stomach', 'Stomach calendar', firstData, today, (k) => {
    const x = by[k], n = keyToDate(k).getDate();
    const d = x ? x.d : {};
    const sc = dayScore(k, d);
    const cls = ['tr-cell'];
    if (k === today) cls.push('today');
    if (k === TR.ssel) cls.push('sel');
    cls.push(sc !== null ? 's' + stomachLevel(sc) : 'empty');
    return '<button type="button" class="' + cls.join(' ') + '" data-tr="sday" data-v="' + k + '" aria-label="' + esc(longDate(k)) +
      (sc !== null ? ', stomach ' + sc : ', no stomach score') + (ome[k] ? ', omeprazole taken' : '') + bowelLabel(d.bx) + '">' + n + (ome[k] ? '<i class="tr-ome"></i>' : '') + bowelMark(d.bx) + '</button>';
  });
  html += '<div class="tr-key"><span>Calm</span><span class="tr-ramp"><i class="s0"></i><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i></span><span>Bad</span>' +
    '<span><i class="tr-ome inline"></i>Omeprazole</span><span><i class="tr-bm loose inline"></i>Loose (6–7)</span><span><i class="tr-bm hard inline"></i>Hard (1–2)</span></div>' +
    (G ? '<p class="tr-detail muted" style="margin-top:4px">Colour = the day’s average stomach pain.</p>' : '');
  const k = TR.ssel && TR.ssel <= today ? TR.ssel : null;
  const parts = G ? dayPartsView(G, today) : '';
  if (!k) return html + '<p class="tr-detail muted">Tap a day to see what you ate.</p>' + parts;
  const d = (by[k] || {}).d || {};
  const g = G && G.by[k];
  const when = g ? GI_PARTS.map((name, i) => (giNum(g[i + 1]) ? name.toLowerCase() + ' ' + g[i + 1] : '')).filter(Boolean).join(', ') : '';
  const bits = [g && giNum(g[0]) ? 'stomach pain avg ' + g[0] + (when ? ' (' + when + ')' : '') : giNum(d.st) ? 'stomach pain up to ' + d.st : '',
    giNum(d.b) ? 'bloating up to ' + d.b : '', g && !giNum(g[1]) && g[5] === 1 ? 'woke with stomach pain' : ''].filter(Boolean);
  const sleepBits = [d.bt ? 'bed ' + d.bt : '', d.wk ? 'woke ' + d.wk : '', d.up ? 'up ' + d.up : ''].filter(Boolean);
  const head = '<b>' + esc(longDate(k)) + '</b>' + (bits.length ? ' · ' + esc(bits.join(', ')) : '') + (ome[k] ? ' · omeprazole' : '') +
    (sleepBits.length ? '<br><span class="small">Night before: ' + esc(sleepBits.join(', ')) + (giNum(d.sl) ? ' · ' + d.sl + ' h in bed' : '') + '</span>' : '');
  const det = TR.days[k];
  let body = '';
  if (!det) body = '<p class="small">Loading…</p>';
  else if (det.error) body = '<p class="small">' + esc(det.error) + '</p>';
  else {
    const list = (title, items) => items.length ? '<div class="tr-day-h">' + title + '</div>' + items.map((x) => '<div class="tr-day-row"><span>' + esc(x.time || '–') + '</span><span>' + esc(x.text) + '</span></div>').join('') : '';
    body = list('Food', det.meals || []) + list('Bowel', det.bowel || []) + list('Medicines', det.meds || []) + list('Stomach scores', det.stomach || []);
    if (!body) body = '<p class="small">Nothing logged that day.</p>';
  }
  return html + '<div class="tr-day"><p class="tr-detail" style="margin:10px 0 6px">' + head + '</p>' + body + '</div>' + parts;
}
const dayLoading = {};
async function loadDayDetail(k) {
  if ((TR.days[k] && !TR.days[k].error) || dayLoading[k]) return;
  dayLoading[k] = true;
  delete TR.days[k];
  try {
    const res = await api({ action: 'day', key: k });
    TR.days[k] = res && res.success ? res : { error: (res && res.error) === 'Unknown action.' ? 'Needs the HealthLog v7 update on the receiver.' : 'Couldn’t load that day.' };
  } catch (e) { TR.days[k] = { error: 'Couldn’t load that day (offline?).' }; }
  delete dayLoading[k];
  if (view === 'trends') trendsRender();
}

/* ---------- Sleep: quality, hours slept and bedtime (from wake and bed check-ins), and how days compare ---------- */
const bedMinutes = (bt) => { const m = /^(\d{2}):(\d{2})$/.exec(bt || ''); if (!m) return null; const v = Number(m[1]) * 60 + Number(m[2]); return v < 12 * 60 ? v + 1440 : v; };
const clockText = (mins) => { const v = Math.round(mins) % 1440; return pad(Math.floor(v / 60)) + ':' + pad(v % 60); };
function sleepView(T2) {
  const list = T2.list.slice(-42), n = list.length;
  const tipOf = (d) => [longDate(d.key), d.d.bt ? 'bed ' + d.d.bt : '', d.d.wk ? 'woke ' + d.d.wk : '', d.d.up ? 'up ' + d.d.up : '',
    giNum(d.d.sl) ? d.d.sl + ' h in bed' : '', giNum(d.d.q) ? 'quality ' + d.d.q + '/10' : '', giNum(d.d.z) ? 'disturbed ' + d.d.z + '/5' : ''].filter(Boolean);
  const hits = (H) => list.map((d, i) => { const t = tipOf(d); return t.length > 1 ? '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (H - 12) + '" class="tr-hit" data-tip="' + esc(t.join(' · ')) + '"/>' : ''; }).join('');
  const W = 360, L = 30, R = 4, bw = (W - L - R) / n;
  const x = (i) => L + i * bw;
  const axis = (H) => '<text x="' + L + '" y="' + (H - 1) + '" class="tr-ax">' + esc(shortDate(list[0].key)) + '</text><text x="' + (W - R) + '" y="' + (H - 1) + '" class="tr-ax" text-anchor="end">' + esc(shortDate(list[n - 1].key)) + '</text>';
  const bars = (get, max, cls, bad, label, unit) => {
    const H = 64, base = H - 12, top = 4;
    let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '" class="tr-grid"/>' +
      '<text x="' + (L - 4) + '" y="' + (top + 6) + '" class="tr-ax" text-anchor="end">' + max + '</text>';
    list.forEach((d, i) => {
      const v = get(d);
      if (typeof v !== 'number') return;
      const h = Math.max(2, (Math.min(v, max) / max) * (base - top));
      svg += '<rect x="' + (x(i) + 1).toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + Math.max(2, bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" class="' + cls + (bad(v) ? ' ' + (cls === 'tr-sleepbar' ? 'poor' : 'short') : '') + '"/>';
    });
    return svg + axis(H) + hits(H) + '</svg>';
  };
  // Bedtime: 21:00 at the top down to 08:00 at the bottom.
  const bedChart = () => {
    const H = 78, top = 6, base = H - 12, lo = 21 * 60, hi = 32 * 60;
    const y = (m) => top + ((Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * (base - top);
    let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bedtime per night">';
    [[24 * 60, '00:00'], [27 * 60, '03:00'], [30 * 60, '06:00']].forEach(([m, t]) => {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(m).toFixed(1) + '" y2="' + y(m).toFixed(1) + '" class="tr-bedline"/><text x="' + (L - 4) + '" y="' + (y(m) + 3).toFixed(1) + '" class="tr-ax" text-anchor="end">' + t + '</text>';
    });
    list.forEach((d, i) => {
      const m = bedMinutes(d.d.bt);
      if (m === null) return;
      svg += '<circle cx="' + (x(i) + bw / 2).toFixed(1) + '" cy="' + y(m).toFixed(1) + '" r="3" class="tr-beddot' + (m >= 27 * 60 ? ' late' : '') + '"/>';
    });
    return svg + axis(H) + hits(H) + '</svg>';
  };
  return '<h2 class="tr-h">Sleep</h2>' +
    '<div class="tr-sub">Bedtime</div>' + bedChart() +
    '<div class="tr-sub">Hours in bed</div>' + bars((d) => d.d.sl, 12, 'tr-hoursbar', (v) => v < 6, 'Hours in bed per night', ' h') +
    '<div class="tr-sub">Sleep quality</div>' + bars((d) => d.d.q, 10, 'tr-sleepbar', (v) => v <= 5, 'Sleep quality per night', '/10') +
    '<p class="small tr-hint">Tap (or hover over) a night for its details.</p>' + patBtn('sleep', 'Sleep patterns');
}

/* ---------- Medication history: pick a medicine, see every day it was logged (scrollable), and how long you've been on it ---------- */
function medsView(today) {
  const data = medCounts();
  if (!data) return '';
  const names = Object.keys(data);
  if (!names.length) return '';
  const cur = TR.med && data[TR.med] ? TR.med : (names.find((n) => /omeprazole/i.test(n)) || names[0]);
  const d = data[cur];
  const taken = Object.keys(d.byDay).filter((k) => d.byDay[k] > 0 && k <= today).sort();
  const firstKey = taken[0] || today;
  let html = '<h2 class="tr-h">Medication</h2><div class="tr-chips tr-medchips">' + names.map((n) => '<button type="button" class="tr-chip" data-tr="med" data-v="' + esc(n) + '" aria-pressed="' + (n === cur) + '">' + esc(n) + '</button>').join('') + '</div>';
  html += calGrid('med-' + cur, cur + ' calendar', firstKey, today, (k) => {
    const n = d.byDay[k] || 0, day = keyToDate(k).getDate();
    const cls = ['tr-cell', n ? (d.perDay > 0 && n < d.perDay ? 'mpart' : 'mon') : 'moff'];
    if (k === today) cls.push('today');
    const amount = d.mg && n ? (d.mg[k] ? d.mg[k] + (d.unknown[k] ? '+' : '') : '?') : '';
    return '<span class="' + cls.join(' ') + '" data-tip="' + esc(longDate(k) + ' · ' + (n ? n + (n === 1 ? ' dose' : ' doses') + (amount ? ' · ' + amount + ' mg' : '') : 'none logged')) + '">' + day + (amount ? '<i class="tr-mg">' + amount + '</i>' : '') + '</span>';
  });
  // How long: the current run (gaps of up to 3 days allowed), the last 14 days, and the first day in the data.
  const stats = [];
  if (taken.length) {
    const lastK = taken[taken.length - 1];
    let runStart = lastK;
    for (let i = taken.length - 2; i >= 0; i--) { if ((keyToDate(runStart) - keyToDate(taken[i])) / 86400000 > 3) break; runStart = taken[i]; }
    const runDays = Math.round((keyToDate(lastK) - keyToDate(runStart)) / 86400000) + 1;
    const current = (keyToDate(today) - keyToDate(lastK)) / 86400000 <= 3;
    stats.push({ label: current ? 'Taking since' : 'Last logged', value: shortDate(current ? runStart : lastK), sub: current ? runDays + (runDays === 1 ? ' day' : ' days') : 'not in the last 3 days' });
    stats.push({ label: 'Last 14 days', value: Array.from({ length: 14 }, (_, i) => addDays(today, -i)).filter((k) => d.byDay[k] > 0).length + ' of 14', sub: 'days logged' });
    stats.push({ label: 'First logged', value: shortDate(taken[0]), sub: taken.length + ' days in all' });
  }
  html += stats.length ? '<div class="pt-stats tr-medstats">' + stats.map((x) => '<div class="pt-cell"><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b><small>' + esc(x.sub) + '</small></div>').join('') + '</div>'
    : '<p class="small">No ' + esc(cur) + ' logged in the last four months.</p>';
  return html + '<p class="small tr-hint">Dark = logged' + (d.perDay > 1 ? ', half = some of ' + d.perDay + ' doses' : '') + (d.mg ? ', small number = mg' : '') + '. Counts logged doses only; before 4am counts as the night before.</p>';
}
/* Sleep: averages, then the next day's score after early vs late, long vs short, good vs poor nights. */
function sleepPatterns(T2) {
  const list = T2.list;
  const nightsQ = list.filter((d) => typeof d.d.q === 'number');
  const nightsH = list.filter((d) => typeof d.d.sl === 'number');
  const nightsB = list.filter((d) => bedMinutes(d.d.bt) !== null);
  const dist = nightsQ.filter((d) => typeof d.d.z === 'number');
  const p = { title: 'Sleep patterns', stats: [], comps: [] };
  if (nightsB.length >= 3) p.stats.push({ label: 'Usual bedtime', value: clockText(mean1(nightsB.map((d) => bedMinutes(d.d.bt)))), sub: nightsB.length + ' nights' });
  if (nightsH.length >= 3) p.stats.push({ label: 'Hours in bed', value: mean1(nightsH.map((d) => d.d.sl)).toFixed(1), sub: 'average' });
  if (nightsQ.length >= 3) p.stats.push({ label: 'Sleep quality', value: mean1(nightsQ.map((d) => d.d.q)).toFixed(1) + '/10', sub: 'average' });
  if (dist.length >= 4) p.stats.push({ label: 'Disturbed', value: mean1(dist.map((d) => d.d.z)).toFixed(1) + '/5', sub: 'average' });
  const compare = (title, a, b, aLabel, bLabel, bName) => {
    const A = a.filter((d) => d.load !== null), B = b.filter((d) => d.load !== null);
    if (A.length < 3 || B.length < 3) return;
    const ga = avgLoad(A), gb = avgLoad(B), v = nextDayVerdict(ga, gb, bName);
    p.comps.push({ title, left: { label: aLabel, value: ga.toFixed(1), sub: A.length + ' nights' }, right: { label: bLabel, value: gb.toFixed(1), sub: B.length + ' nights' }, verdict: v.text, tone: v.tone });
  };
  compare('Day score after early vs late nights', nightsB.filter((d) => bedMinutes(d.d.bt) < 26 * 60), nightsB.filter((d) => bedMinutes(d.d.bt) >= 27 * 60), 'Bed before 02:00', 'Bed after 03:00', 'late nights');
  compare('Day score after long vs short nights', nightsH.filter((d) => d.d.sl >= 7.5), nightsH.filter((d) => d.d.sl < 6), '7½ h or more', 'Under 6 h', 'short nights');
  compare('Day score after good vs poor nights', nightsQ.filter((d) => d.d.q >= 7), nightsQ.filter((d) => d.d.q <= 5), 'Quality 7+', 'Quality 5 or under', 'poor nights');
  if (!p.stats.length && !p.comps.length) p.empty = 'Not enough nights yet. Bed and Wake check-ins (or saying “went to sleep at 4:30” in a wake note) fill this in.';
  else p.note = 'Day score = the average of the symptoms you chose at the top (higher = heavier day), on the day after each night.';
  return p;
}

function trendsClick(ev) {
  const tip = ev.target.closest('[data-tip]');
  if (tip && !tip.closest('[data-tr]')) { showTip(tip); return; }
  const el = ev.target.closest('[data-tr]');
  if (!el) return;
  const act = el.dataset.tr, v = el.dataset.v;
  if (act === 'day') { TR.sel = TR.sel === v ? null : v; trendsRender(); if (TR.sel) loadDayDetail(TR.sel); }
  else if (act === 'series') {
    TR.on = TR.on.includes(v) ? TR.on.filter((x) => x !== v) : TR.on.concat(v);
    if (!TR.on.length) TR.on = ['load'];
    LS.set('trends.on', TR.on); trendsRender();
  }
  else if (act === 'inc') {
    TR.inc = TR.inc.includes(v) ? TR.inc.filter((x) => x !== v) : TR.inc.concat(v);
    if (!TR.inc.length) TR.inc = [v];
    LS.set('trends.inc', TR.inc); trendsRender();
  }
  else if (act === 'sday') { TR.ssel = TR.ssel === v ? null : v; trendsRender(); if (TR.ssel) loadDayDetail(TR.ssel); }
  else if (act === 'pat') { TR.pop = v; TR.popFresh = true; trendsRender(); }
  else if (act === 'med') { TR.med = v; LS.set('trends.med', v); trendsRender(); }
  else if (act === 'pat-close') closePatterns();
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
  else if (ev.target.id === 'log-inbox-form') { ev.preventDefault(); logInboxSubmit(); }
});

window.addEventListener('online', () => { logFlush(); inboxFlush(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  logFlush();
  if (view === 'log') { logRenderSoft(); logRefreshConfig(); }
  inboxFlush();
  // (hidden tabs are never the current view, so nothing below loads for them)
  if ((view === 'ahead' || view === 'money') && Conn.paired()) showView(view);
  if (view === 'trends') trendsEnter();
  if (view === 'today' && Conn.paired()) {
    if (T.loadedDate && !T.manual && londonWorkingDay(T.rolloverMinutes) !== T.loadedDate) { T.choice = null; loadDay(true); }
    else if (Date.now() - T.lastLoad > 120000) loadDay(false);
  }
});
setInterval(() => {
  if (document.hidden) return;
  if (view === 'log' && !S.timeOpen && !S.open && !S.sheet) logRenderSoft();
  if (queue.length) logFlush();
}, 60000);

applyTabs();
showView(tabOn(START) ? START : tabsOn()[0]);
if (Conn.canLog() && (tabOn('log') || tabOn('trends'))) { logFlush(); logRefreshConfig(); }

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
