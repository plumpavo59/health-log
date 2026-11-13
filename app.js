/* Life HQ phone app: Today (dashboard) and Health log in one page.
   Each Home Screen icon opens on its own tab and is paired separately (iPhone keeps
   each icon's storage apart). Talks only to the Ru - Inbox Receiver script. */
'use strict';
/* Older browsers (e.g. e-ink tablets with an old built-in WebView) lack a few newer functions. */
if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren = function () { while (this.firstChild) this.removeChild(this.firstChild); this.append.apply(this, arguments); };
if (!DocumentFragment.prototype.replaceChildren) DocumentFragment.prototype.replaceChildren = Element.prototype.replaceChildren;
if (!Object.fromEntries) Object.fromEntries = (it) => { const o = {}; for (const [k, v] of it) o[k] = v; return o; };
if (!String.prototype.replaceAll) String.prototype.replaceAll = function (a, b) { return this.split(a).join(b); };
const APP_VERSION = 'v78 · 13 Nov';
const ROOT = document.documentElement;
/* v40 share mode: a link ending #share=<receiver id> opens a view-only Health page for one person, who
   unlocks it with their own password (Sharing tab in the health tracker). Nothing can be logged from it. */
const SHARE_ID = (/[#&]share=([\w-]{20,120})/.exec(location.hash) || [])[1] || '';
if (SHARE_ID) ROOT.classList.add('share-mode');
const START = SHARE_ID ? 'trends' : ROOT.dataset.start === 'today' ? 'today' : 'log';
const BASE = ROOT.dataset.base || './';
const UNDO_MS = 5000;
// v47: the Life HQ GPT button (top right of Today) is switched off; set to true to bring it back.
const SHOW_GPT_BUTTON = false;
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
  // Share mode keeps its own storage, apart from Ru's own app on the same device.
  get(k, d) { try { const v = localStorage.getItem((SHARE_ID ? 'hls.' : 'hl.') + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem((SHARE_ID ? 'hls.' : 'hl.') + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem((SHARE_ID ? 'hls.' : 'hl.') + k); } catch (e) {} }
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
const Conn = SHARE_ID ? {
  endpoint: () => 'https://script.google.com/macros/s/' + SHARE_ID + '/exec',
  token: () => '', key: () => '', paired: () => false,
  canLog: () => !!LS.get('sharepw', '')
} : {
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
  if (SHARE_ID) {
    const pw = LS.get('sharepw', '');
    if (!pw) throw new Error('No password');
    const res = await rawPost(Conn.endpoint(), Object.assign({}, body, { share: pw }));
    if (res && res.auth === false) { LS.del('sharepw'); SHR.error = res.error || 'That password didn’t work.'; if (view === 'trends') trendsRender(); }
    return res;
  }
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
const tabsOn = () => { if (SHARE_ID) return ['trends']; const t = LS.get('tabs', null); const ok = Array.isArray(t) ? t.filter((x) => ALL_TABS.some(([k]) => k === x)) : []; return ok.length ? ok : ALL_TABS.map(([k]) => k); };
const tabOn = (v) => tabsOn().includes(v);
function applyTabs() { document.querySelectorAll('#tabbar [data-tab]').forEach((b) => { b.hidden = !tabOn(b.dataset.tab); }); }
// v42: each device can choose the tab it opens on (Settings › Opens on); otherwise the icon's own start tab.
const openTab = () => { const p = SHARE_ID ? null : LS.get('start', null); return p && tabOn(p) ? p : tabOn(START) ? START : tabsOn()[0]; };
let view = null, lastMainView = openTab();
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
    '<h2>TABS ON THIS DEVICE' + sInfo('Hidden tabs don’t load at all, so a slow device (like the e-ink tablet) stays quick. Only this device changes.') + '</h2><div class="chips" role="group" aria-label="Tabs on this device">' + ALL_TABS.map(([k, l]) =>
      '<button type="button" class="chip" data-act="tab-toggle" data-v="' + k + '" aria-pressed="' + tabOn(k) + '"><b>' + l + '</b></button>').join('') + '</div>' +
    '<h2>OPENS ON</h2><div class="chips" role="group" aria-label="Tab this device opens on">' + ALL_TABS.filter(([k]) => tabOn(k)).map(([k, l]) =>
      '<button type="button" class="chip" data-act="start-tab" data-v="' + k + '" aria-pressed="' + (openTab() === k) + '"><b>' + l + '</b></button>').join('') + '</div>' +
    '<h2>THIS DEVICE</h2><div class="notice">' + state +
      '<div class="row2" style="margin-top:10px"><button type="button" class="seg" data-act="pair-open">' + (Conn.paired() ? 'Pair again' : 'Pair this device') + '</button>' +
      (Conn.paired() ? '<button type="button" class="seg" data-act="unpair">' + (unpairArmed ? 'Tap again to unpair' : 'Unpair') + '</button>' : '') + '</div></div>' +
    (Conn.paired() ? '<details class="s-fold"><summary><h2>PAIRED DEVICES' + (devices ? ' · ' + devices.length : '') + '</h2></summary>' + devicesMarkup() + '</details>' : '') +
    (Conn.paired() ? '<h2>SHARE THE HEALTH PAGE' + sInfo('A view-only copy of the Health tab for family or health professionals. Give each person the link and their own password from the health tracker’s Sharing tab, where you also choose which sections they see and where they start. Untick Active to stop someone’s access. The tab shows when each person last looked and for how long.') + '</h2>' +
      '<div class="row2"><button type="button" class="seg" data-act="share-copy">Copy share link</button></div>' : '') +
    (Conn.paired() ? '<h2>DASHBOARD IDEAS</h2><textarea id="dash-note" class="text-input grow" rows="2" maxlength="2000" placeholder="A change you’d like in this app…" aria-label="Dashboard idea"></textarea>' +
      '<div class="row2" style="margin-top:8px"><button type="button" class="seg" data-act="dash-note">Send to the backlog</button></div>' : '') +
    '<h2>LINKS</h2>' + fileLinks([['Health tracker', LINKS.healthSheet], ['Life HQ sheet', LINKS.hqSheet], ['Finances', LINKS.moneySheet], ['Works &amp; Royalties', LINKS.works], ['Inventory', LINKS.inventory], ['Todoist', 'https://app.todoist.com/app/today'], ['Health GPT', LINKS.healthGpt], ['Finances GPT', LINKS.moneyGpt]]) +
    '<h2>ABOUT</h2><p class="small">Life HQ app ' + esc(APP_VERSION) + '.</p>' +
    '<div class="row2"><button type="button" class="seg" data-act="update">Check for update</button><button type="button" class="seg" id="test-celebration" data-act="celebrate">Test celebration</button></div>';
  if (Conn.paired() && devices === null && !devicesError) loadDevices();
}

/* v54: a small (i) in Settings headings that unfolds its explanation. */
const sInfo = (text) => '<details class="s-info"><summary aria-label="About this">i</summary><p class="small">' + text + '</p></details>';
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
  else if (act === 'start-tab') { LS.set('start', v); settingsRender(); toast('This device will open on ' + (ALL_TABS.find(([k]) => k === v) || [, v])[1] + '.'); }
  else if (act === 'share-copy') {
    const m = /\/macros\/s\/([\w-]+)\//.exec(Conn.endpoint() || '');
    if (!m) { toast('Couldn’t work out the link. Pair this device first.'); return; }
    const link = location.origin + location.pathname.replace(/[^/]*$/, '').replace(/today\/$/, '') + '#share=' + m[1];
    try { await navigator.clipboard.writeText(link); toast('Share link copied.'); } catch (e) { window.prompt('Copy this link:', link); }
  }
  else if (act === 'dash-note') {
    const box = $('dash-note'), text = box ? box.value.trim() : '';
    if (!text) { toast('Type the idea first.'); return; }
    queueInbox((/^dashboard:/i.test(text) ? '' : 'Dashboard: ') + text, 'settings');
    box.value = ''; autoGrow(box); toast('Sent to the dashboard backlog.');
  }
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
  if (typeof sleepMarks === 'function' && sleepMarks().bed) return 'Bed';  // v74: "Into bed tonight" logged
  if (mins >= 23 * 60 + 30 || h < 4) return 'Bed';
  // v74: the first check-in before noon assumes he's still in bed, unless he's already out of bed or has done a
  // check-in today that wasn't in bed; then later ones are day check-ins.
  if (h < 12 && !upToday() && !uprightToday()) return 'Wake';
  return 'Day';
}
const guessStage = () => (wokeToday() ? 'up' : 'bed');

const S = {
  suppOn: false, supps: [],
  open: false, period: null, stage: null, scores: {}, checkNote: '', calMed: null, moment: [], momentNote: '',
  bristol: null, size: null, urgent: false, bpain: '', bowelNote: '',
  meds: [], doses: {}, food: '', time: null, timeOpen: false,
  sheet: null, sheetFresh: false, refreshing: false, inboxText: '', inboxStatus: '', dirty: false,
  sleepT: { bed: '', wake: '', up: '' }, wakeFlags: {},
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
function planHtml(today, withCompare, listInPopup) {
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
  const listHtml = '<div class="plan-list">' + list + '</div>' + '<p class="small">From the health tracker’s Meds tab (PLAN). Proposed steps aren’t agreed yet.</p>';
  if (listInPopup === 'list') return (cfg.plan.note ? '<p class="small">' + esc(cfg.plan.note) + '</p>' : '') + listHtml;
  if (listInPopup) return svg + key + patBtn('plan', 'Step details') + (withCompare ? patBtn('steps', 'Compare steps') : '');
  return svg + key + (cfg.plan.note ? '<p class="small">' + esc(cfg.plan.note) + '</p>' : '') + (withCompare ? patBtn('steps', 'Compare steps') : '') + listHtml;
}
/* v38: symptoms since the current step started vs the 4 weeks before it. */
// v57: any step (index into planSteps), compared with the 4 weeks before it started; default = the current step.
function trialEffect(T2, today, si) {
  const steps = planSteps();
  const st = si === undefined ? steps.find((x) => stepState(x, today) === 'now') : steps[si];
  if (!st || !T2) return null;
  const start = st.from, before0 = addDays(start, -28), end = st.to && st.to < today ? st.to : today;
  const since = T2.list.filter((x) => x.key >= start && x.key <= end), before = T2.list.filter((x) => x.key >= before0 && x.key < start);
  const rows = TREND_SYMS.map((sm) => ({ name: sm.name, get: (d) => { const v = symVal(d, sm.k); return typeof v === 'number' ? (sm.inv ? 10 - v : v) : null; }, up: !!sm.inv }))
    .concat([{ name: 'Stomach pain', get: (d) => (giNum(symVal(d, 'st')) ? symVal(d, 'st') : null) }, { name: 'Bloating', get: (d) => (giNum(symVal(d, 'b')) ? symVal(d, 'b') : null) },
      { name: 'Sleep quality', get: (d) => (giNum(d.q) ? d.q : null), up: true }]);
  const m = (arr, get) => mean1(arr.map((x) => get(x.d)).filter((v) => typeof v === 'number'));
  const out = rows.map((r) => { const a = m(before, r.get), b = m(since, r.get); return { name: r.name, a, b, up: r.up, d: a !== null && b !== null ? b - a : null }; }).filter((r) => r.a !== null && r.b !== null);
  const da = mean1(before.map((x) => x.load).filter(giNum)), db = mean1(since.map((x) => x.load).filter(giNum));
  return { st, start, end, done: end < today, days: dayNum(start, end), rows: out, score: da !== null && db !== null ? { a: da, b: db, d: db - da } : null };
}
const effWord = (r) => { if (Math.abs(r.d) < 0.4) return { text: 'about the same', tone: 'same' }; const better = r.up ? r.d > 0 : r.d < 0; return { text: (r.d > 0 ? '+' : '−') + Math.abs(r.d).toFixed(1) + (better ? ' better' : ' worse'), tone: better ? 'better' : 'worse' }; };
function trialEffectHtml(T2, today) {
  // v57: one block per step that has started (current first, then finished ones), each with its own popup.
  const steps = planSteps();
  return steps.map((st, i) => [st, i]).filter(([st]) => { const k = stepState(st, today); return (k === 'now' || k === 'done') && st.to !== st.from; })
    .sort((a, b) => (b[0].from > a[0].from ? 1 : -1)).map(([st, i]) => trialEffectBlock(T2, today, i)).join('');
}
function trialEffectBlock(T2, today, si) {
  const e = trialEffect(T2, today, si);
  if (!e || !e.rows.length) return '';
  const num = (/^(\d+)/.exec(e.st.label) || [])[1], name = e.st.label.replace(/^\d+\s*·\s*/, '');
  const top = e.rows.filter((r) => Math.abs(r.d) >= 0.4).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2);
  const tile = (label, r) => { const w = effWord(r); return '<div class="tr-stat"><span>' + esc(label) + '</span><b class="eff-' + w.tone + '">' + esc(w.text === 'about the same' ? 'Same' : w.text.split(' ')[0]) + '</b><small>' + esc(r.a.toFixed(1) + ' → ' + r.b.toFixed(1) + (w.tone === 'same' ? '' : ' · ' + w.text.split(' ')[1])) + '</small></div>'; };
  const tiles = (e.score ? [tile('Day score', Object.assign({ up: false }, e.score))] : []).concat(top.map((r) => tile(r.name, r)));
  const span = e.done ? shortDate(e.start) + ' – ' + shortDate(e.end) + ' (' + e.days + ' days)' : 'Since ' + shortDate(e.start) + ' (' + e.days + (e.days === 1 ? ' day' : ' days') + ')';
  return '<h3 class="tr-trial-h">Trial · Step ' + esc(num || '') + ': ' + esc(name) + (e.done ? '' : ' <span class="tr-now">now</span>') + '</h3><div class="tr-sub">' + esc(span) + ' vs the 4 weeks before</div><div class="tr-stats">' + tiles.join('') + '</div>' + patBtn('trialfx:' + si, 'All symptoms: step ' + (num || '') + ' vs before');
}
function trialEffectPop(T2, today, si) {
  const e = trialEffect(T2, today, si);
  if (!e) return null;
  const range = shortDate(e.start) + (e.done ? ' – ' + shortDate(e.end) : ' – today');
  return { title: 'Step: ' + e.st.label.replace(/^\d+\s*·\s*/, ''), comps: e.rows.map((r) => { const w = effWord(r); return { title: r.name, left: { label: '4 weeks before', value: r.a.toFixed(1) }, right: { label: range, value: r.b.toFixed(1) }, verdict: w.text.charAt(0).toUpperCase() + w.text.slice(1), tone: w.tone }; }),
    note: 'Daily averages of your readings: ' + shortDate(addDays(e.start, -28)) + ' – ' + shortDate(addDays(e.start, -1)) + ' against ' + range + '. Higher is better for mental clarity, mood and sleep quality; lower is better for the rest. Changes under 0.4 count as the same. Other things change too (sleep, activity, stress), so this shows what happened, not what caused it.' };
}
/* v39: the supplement plan from the Meds tab (HealthLog v15e), or just the app's list on older receivers. */
function suppPlanPop() {
  const sp = cfg.suppPlan;
  const rows = sp && sp.rows ? sp.rows : suppList().map((x) => ({ name: x.name, product: x.detail, def: x.def, status: '', when: '', advice: '' }));
  const h = rows.map((r) => '<div class="sp-row"><div class="sp-top"><b>' + esc(r.name) + '</b>' + (r.status ? '<span class="ps-chip">' + esc(r.status) + '</span>' : '') + '</div>' +
    (r.product ? '<div class="sp-line">' + esc(r.product) + '</div>' : '<div class="sp-line muted">No product set</div>') +
    (r.when ? '<div class="sp-line"><span>When</span> ' + esc(r.when) + '</div>' : '') +
    (r.advice ? '<div class="sp-line"><span>Plan</span> ' + esc(r.advice) + '</div>' : '') +
    '<div class="sp-line small">' + (r.def ? 'Ticked by default in the app' : 'Not ticked by default') + '</div></div>').join('');
  return { title: 'Supplements', html: h + (sp && sp.notes ? sp.notes.map((t) => '<p class="small">' + esc(t) + '</p>').join('') : '') +
    '<p class="small">From the health tracker’s Meds tab (SUPPLEMENTS · PLAN). Change products, plan and defaults there.' + (sp ? '' : ' Plan details need the receiver update HealthLog v15e.') + '</p>' };
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

/* v77: an entry from this phone still counts locally until a sheet read that started after it was saved, so
   counts don't drop back for the few seconds between "saved" and the next config arriving. */
const notYetInSheet = (r) => r.status !== 'failed' && (r.status !== 'saved' || !r.savedAt || !cfg.at || cfg.at <= r.savedAt);
/* Medication history: health days (before 04:00 counts as the previous day). */
function medCounts() {
  const h = cfg.history;
  if (!h || !Array.isArray(h.meds)) return null;
  const map = {};
  h.meds.forEach((m) => {
    const byDay = {}, mg = Array.isArray(m.mg) ? {} : null, unknown = {}, names = {};
    (m.counts || []).forEach((n, i) => { if (n) byDay[addDays(h.startKey, i)] = n; });
    if (Array.isArray(m.names)) m.names.forEach((l, i) => { if (l && l.length) names[addDays(h.startKey, i)] = l.slice(); });
    if (mg) m.mg.forEach((n, i) => { const k = addDays(h.startKey, i); if (n) mg[k] = n; if ((m.mgUnknown || [])[i]) unknown[k] = true; });
    recent.forEach((r) => {
      if (r.kind === 'meds' && notYetInSheet(r) && (r.meds || []).includes(m.name)) {
        const k = r.hday || r.day; byDay[k] = (byDay[k] || 0) + 1;
        if (mg) { const n = doseMg((r.doses || {})[m.name]); if (n === null) unknown[k] = true; else mg[k] = (mg[k] || 0) + n; }
      }
      // v29: supplements not yet in the server's history (2 = all due, 1 = some).
      if (m.supps && r.kind === 'supps' && notYetInSheet(r) && (r.supps || []).length) {
        const k = r.hday || r.day, due = Number(r.due) || 1;
        byDay[k] = Math.max(byDay[k] || 0, r.supps.length >= due ? 2 : 1);
        names[k] = (names[k] || []).concat(r.supps.filter((x) => !(names[k] || []).includes(x)));
      }
    });
    map[m.name] = { perDay: m.perDay || 1, byDay, mg, unknown, supps: !!m.supps, names };
  });
  // v30: Supplements sit just above the as-needed medicines (Per day 0, e.g. co-codamol, paracetamol).
  return suppFirst(map);
}

const suppWord = (n) => (n >= 2 ? 'all due taken' : 'some taken');
const asNeeded = (name) => (cfg.meds || []).some((m) => m.name === name && Number(m.perDay) === 0);
function suppFirst(map) {
  if (!map.Supplements) return map;
  const out = {};
  Object.keys(map).forEach((n) => { if (asNeeded(n) && !out.Supplements) out.Supplements = map.Supplements; if (n !== 'Supplements') out[n] = map[n]; });
  if (!out.Supplements) out.Supplements = map.Supplements;
  return out;
}

function historyView(mode) {
  const health = mode === 'health';
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
    const open = health ? TR.medOpen === name : S.calMed === name;
    html += '<button type="button" class="hist-row' + (health && open ? ' open' : '') + '" ' + (health ? 'data-tr="medrow"' : 'data-act="cal"') + ' data-v="' + esc(name) + '" aria-expanded="' + open + '" aria-label="' + esc(name) + ': logged on ' + taken + ' of the last 14 days. Show calendar">' +
      '<span class="hist-name">' + esc(name) + '</span><span class="hist-cells">' +
      keys.map((k) => '<span class="' + cls(d.byDay[k] || 0, d.perDay, k) + '"></span>').join('') + '</span>' +
      '<span class="hist-n">' + taken + '/14</span></button>';
    if (!health && S.calMed === name) html += calendarView(name, d, today, cls);
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
    cells += '<span class="d ' + cls(n, d.perDay, k) + (d.mg ? ' dosed' : '') + '" title="' + esc(k) + (n ? ': ' + (d.supps ? suppWord(n) + (d.names[k] ? ': ' + d.names[k].join(', ') : '') : n) + (amount ? ' · ' + amount + ' mg' : '') : '') + '">' +
      (d.mg ? '<span>' + label + '</span><i>' + amount + '</i>' : label) + '</span>';
  }
  const count = (days) => Array.from({ length: days }, (_, i) => addDays(today, -i)).filter((k) => (d.byDay[k] || 0) > 0).length;
  const week = d.mg ? Array.from({ length: 7 }, (_, i) => addDays(today, -i)).reduce((t, k) => t + (d.mg[k] || 0), 0) : 0;
  return '<div class="cal"><div class="cal-sum">' + esc(name) + ' · last 7 days ' + count(7) + ' · last 14 ' + count(14) + ' · last 6 weeks ' + count(42) +
    (d.mg ? ' · 7-day total ' + week + ' mg' : '') + '</div>' +
    '<div class="cal-grid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => '<span class="dow">' + x + '</span>').join('') + cells + '</div>' +
    '<div class="cal-sum">Dark = logged' + (d.mg ? ' · small number = mg that day (? = dose not recorded)' : '') + (d.supps ? ' · half = some of the ones due (Default on the Meds tab)' : d.perDay > 1 ? ' · half = some of ' + d.perDay + ' doses' : '') + ' · before 4am counts as the night before</div></div>';
}

/* v73/v74: sleep times, separate from check-ins. Three buttons: last night's "Into bed", today's "Out of bed" and
   "Into bed tonight". One tap opens a small window with the time (now, or the real time typed later); a time already
   logged opens to change it. Saved as a Check-in row (Period Bed / Getting up, no ratings, "sleep time only"), which
   the Oura script and the app read as in bed / out of bed. The ring's own night (asleep, woke, hours) shows beside it. */
const SLEEP_SLOTS = { lastbed: 'Into bed last night', up: 'Out of bed', bed: 'Into bed tonight' };
function sleepMarks() {
  const m = (cfg.today && cfg.today.sleepMarks) || {}, K = healthKey(new Date());
  const out = { lastbed: m.lastBed || null, up: m.up || null, bed: m.tonightBed || null, night: m.night || null };
  recent.forEach((r) => {
    if (r.status === 'failed' || !r.sleepSlot || r.sleepK !== K) return;
    if (r.status === 'saved' && cfg.at && r.savedAt && r.savedAt < cfg.at) return;  // already in what the sheet sent back
    const t = new Date(r.at).getTime();
    if (!out[r.sleepSlot] || !out[r.sleepSlot].row || t > out[r.sleepSlot].t) out[r.sleepSlot] = { hm: r.hm, t, local: true, place: r.place || '' };
  });
  if (out.bed && out.up && out.bed.t < out.up.t) out.bed = null;
  return out;
}
/* The real date for a typed time, by which button it is (K = today's health day, 04:00–04:00). */
function sleepSlotDate(slot, hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number), K = healthKey(new Date());
  const key = slot === 'lastbed' ? (hh >= 12 ? addDays(K, -1) : K) : slot === 'up' ? (hh < DAY_START_HOUR ? addDays(K, 1) : K) : (hh >= 12 ? K : addDays(K, 1));
  const d = keyToDate(key); d.setHours(hh, mm, 0, 0);
  return d;
}
const uprightToday = () => !!(cfg.today && cfg.today.upright) ||
  recent.some((r) => r.hday === healthKey(new Date()) && r.kind === 'checkin' && r.status !== 'failed' && r.period && !/^(Wake|Bed)$/.test(r.period));
/* v77: one slim row under the quick buttons, only when it's useful: in the morning (04:00–15:00) until last
   night's into-bed and this morning's out-of-bed are both logged, and in the evening (21:00–04:00) until tonight's
   into-bed is logged. Logged times can still be changed from Logged today. */
function sleepCardView() {
  const m = sleepMarks(), n = m.night || {}, h = new Date().getHours();
  const pill = (k, label) => '<button type="button" class="sleep-pill' + (m[k] ? ' done' : '') + '" data-act="sleep-open" data-v="' + k + '">' +
    esc(label) + ' <b>' + (m[k] ? esc(m[k].hm) : 'log') + '</b></button>';
  let body = '';
  if (h >= 4 && h < 15 && (!m.lastbed || !m.up)) {
    body = '<span class="sleep-h">Last night</span>' + pill('lastbed', 'Bed') + pill('up', 'Up') +
      (typeof n.sl === 'number' ? '<span class="sleep-hrs">' + n.sl + ' h</span>' : '');
  } else if ((h >= 21 || h < 4) && !m.bed) {
    body = '<span class="sleep-h">Tonight</span>' + pill('bed', 'Into bed');
  }
  return body ? '<div class="sleep-strip" role="group" aria-label="Sleep times">' + body + '</div>' : '';
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
    const list = (period === 'Wake' && stage === 'bed' ? SLEEP.map(([k, l, m]) => [k, l, m]) : []).concat(SCALES.map(([k, l]) => [k, l, 10]))
      .concat(period === 'Bed' || (period === 'Day' && new Date().getHours() >= 18) ? [['stress', 'Stress today (0–5)', 5]] : []);  // whole-day stress (Stress column); v74: also on day check-ins from 18:00
    html += '<div id="check-body" style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="grid3" role="group" aria-label="When">' + ['Wake', 'Day', 'Bed'].map((p) =>
        '<button type="button" class="seg" data-act="period" data-v="' + p + '" aria-pressed="' + (period === p) + '">' + p + '</button>').join('') + '</div>' +
      (period === 'Wake' ? '<div class="grid2 stage-row" role="group" aria-label="Wake stage">' + [['bed', 'In bed'], ['up', 'Getting up']].map(([k, l]) =>
        '<button type="button" class="seg" data-act="stage" data-v="' + k + '" aria-pressed="' + (stage === k) + '">' + l + '</button>').join('') + '</div>' : '') + '<div>' +
      list.map(([k, l, max]) => {
        const v = S.scores[k];
        const set = v !== undefined;
        // v39: sleep times sit straight under the sleep sliders (or first, when there are none).
        const times = period === 'Wake' && (k === 'disturb' || (k === list[0][0] && !list.some((x) => x[0] === 'disturb'))) ? sleepTimesHtml() : '';
        const slider = '<div class="scale"><label for="r-' + k + '">' + l + '</label>' +
          '<input id="r-' + k + '" type="range" min="0" max="' + max + '" step="0.5" value="' + (set ? v : max / 2) + '" data-score="' + k + '"' + (set ? '' : ' class="unset"') + '>' +
          '<output id="o-' + k + '" for="r-' + k + '"' + (set ? '' : ' class="unset"') + '>' + (set ? v : '–') + '</output></div>';
        return k === 'disturb' ? slider + times : times + slider;
      }).join('') + '</div>' +
      momentsView() +
      '<input type="text" data-field="checkNote" value="' + esc(S.checkNote) + '" placeholder="Note (optional)" aria-label="Check-in note" autocomplete="off">' +
      '<button type="button" class="log wide" id="check-save" data-act="checkin"></button></div>';
  }
  return html + '</section>';
}

function sleepTimesHtml() {
  // v56: the Oura ring gives went-to-sleep and woke; they fold away under "Ring off?", got-up stays.
  const keys = S.ringOff ? [['bed', 'Went to sleep'], ['wake', 'Woke'], ['up', 'Got up']] : [['up', 'Got up']];
  return '<div class="sleep-times' + (S.ringOff ? '' : ' one') + '" role="group" aria-label="Sleep times">' + keys.map(([k, l]) =>
    '<label><span>' + l + '</span><input type="time" data-sleep="' + k + '" value="' + esc(S.sleepT[k]) + '"></label>').join('') +
    '<button type="button" class="link-btn ring-off" data-act="ring-off">' + (S.ringOff ? 'Hide sleep times' : 'Ring off? Add sleep times') + '</button></div>' +
    // v54/v62: on waking, yes/no buttons (bad taste, tinnitus, sore throat), saved in the check-in's note ("Morning: bad taste on waking: yes").
    '<div class="wake-flags" role="group" aria-label="On waking">' + WAKE_FLAGS.map(([k, l]) => '<button type="button" class="moment-btn" data-act="wake-flag" data-v="' + k + '" aria-pressed="' + !!S.wakeFlags[k] + '">' + l + '</button>').join('') + '</div>';
}
const WAKE_FLAGS = [['taste', 'Bad taste', 'bad taste on waking: yes'], ['tinnitus', 'Tinnitus', 'tinnitus on waking: yes'], ['throat', 'Sore throat', 'sore throat on waking: yes']];
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
    trialView() + logInboxView() + checkinView() + quickView() + sleepCardView() +
    (waiting ? '<div class="queue-note"><span>' + waiting + ' waiting to send</span><button type="button" class="link-btn" data-act="flush">Send now</button></div>' : '') +
    // v49: Logged today is folded by default; just-logged entries (with Undo) and problems still show.
    (rows.length || failed.length ? '<section class="recent" aria-label="Logged today"><button type="button" class="recent-toggle" data-act="logged-toggle" aria-expanded="' + !!S.loggedOpen + '"><h2>LOGGED TODAY <span class="rc-n">' + rows.length + '</span></h2><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' + missingRows().map((m) =>
      '<div class="lrow warn"><span class="t">' + esc(m.r.hm) + '</span><span>' + esc(m.miss.join(', ')) + ' not in the sheet</span><button type="button" class="link-btn" data-act="readd" data-v="' + esc(m.r.id) + '">Re-add</button></div>').join('') + rows.filter((r) => S.loggedOpen || r.status === 'pending').map((r) =>
      '<div class="lrow"><span class="t">' + esc(r.hm || '–') + '</span><span>' + esc(r.text) + '</span>' +
      (r.status === 'pending' ? '<button type="button" class="link-btn" data-act="undo" data-v="' + esc(r.id) + '">Undo</button>' :
        r.local && r.status !== 'saved' ? '<span class="st">Waiting</span>' : '<span class="st">' + esc(r.src || '') + (r.row ? '</span><button type="button" class="link-btn lr-edit" data-act="edit-open" data-v="' + r.row + '">Edit</button>' : '</span>')) + '</div>').join('') +
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
const IMG_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>';
const CAM_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
/* v56: shrink a meal photo to at most 1600 px (JPEG) so it sends quickly. */
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t || (t.id !== 'food-photo' && t.id !== 'food-photo-lib') || !t.files || !t.files[0]) return;
  const file = t.files[0];
  // v72: a photo from the library keeps its own time for the meal (when the phone passes it on and nothing else was chosen).
  if (t.id === 'food-photo-lib' && !S.time && file.lastModified) {
    const age = Date.now() - file.lastModified;
    if (age > 10 * 60000 && age < 3 * 86400000) { S.time = new Date(file.lastModified); toast('Time set from the photo: ' + pad(S.time.getHours()) + ':' + pad(S.time.getMinutes())); }
  }
  S.photoBusy = true; logRender();
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    S.foodPhoto = c.toDataURL('image/jpeg', 0.8); S.photoBusy = false; logRender();
    const f = $('food-input'); if (f) f.focus();
  };
  img.onerror = () => { URL.revokeObjectURL(url); S.photoBusy = false; toast('Couldn’t read that photo.'); logRender(); };
  img.src = url;
});
const CAL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
const CLOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
/* One tap opens the phone's date/time picker straight away (an invisible input sits over the pill). */
function timePill(label) {
  const now = new Date();
  // v52: one tap opens just the time (same day; a time later than now means last night). The small
  // calendar button next to it changes the date as well.
  const base = S.time || now;
  return '<span class="time-pick-wrap"><label class="pill time-pick' + (S.time ? ' set' : '') + '">' + CLOCK_SVG + esc(label) +
    '<input type="time" class="time-overlay" aria-label="Time for the next entry: ' + esc(label) + '" value="' + pad(base.getHours()) + ':' + pad(base.getMinutes()) + '"></label>' +
    '<label class="pill date-pick" aria-label="Change the date">' + CAL_SVG +
    '<input type="datetime-local" class="time-overlay" aria-label="Date and time for the next entry" value="' + localInputValue(base) + '" min="' + localInputValue(new Date(now.getTime() - 3 * 86400000)) + '" max="' + localInputValue(new Date(now.getTime() + 10 * 60000)) + '"></label>' +
    (S.time ? '<button type="button" class="time-reset" data-act="time-now" aria-label="Back to now">Now</button>' : '') + '</span>';
}
/* v74: laptops: the calendar button opens the browser's date-and-time picker (the hidden box alone gave nothing). */
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!t || !t.matches || !t.matches('.date-pick .time-overlay') || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  try { t.showPicker(); } catch (e) { /* older browsers: the box still takes typing */ }
});
function timePanel(now) {
  return '<div class="time-panel"><label for="time-input" class="small">Time for the next entry</label>' +
    '<input id="time-input" type="datetime-local" value="' + localInputValue(S.time || now) + '" max="' + localInputValue(new Date(now.getTime() + 10 * 60000)) + '">' +
    '<div class="btns"><button type="button" class="log" data-act="time-set">Use this time</button><button type="button" class="seg" data-act="time-now">Now</button></div></div>';
}
function todayListHtml(kind) {
  const rows = todayEntries().filter((r) => r.kind === kind).reverse();
  if (!rows.length) return '';
  // v48: the 3 latest, with the rest behind "Show all", so the window stays short.
  const all = S.todayAll === kind, shown = all ? rows : rows.slice(0, 3);
  return '<div class="sheet-today"><div class="opt-h">Today</div>' + shown.map((r) => '<div class="lrow"><span class="t">' + esc(r.hm || '–') + '</span><span>' + esc(r.text) + '</span>' + (r.src ? '<span class="st">' + esc(r.src) + '</span>' : '') + '</div>').join('') +
    (rows.length > 3 ? '<button type="button" class="link-btn today-more" data-act="today-all" data-v="' + kind + '">' + (all ? 'Show fewer' : 'Show all ' + rows.length) + '</button>' : '') + '</div>';
}
/* v48: keep windows above the iPhone keyboard. The visual viewport shrinks when the keyboard opens;
   the open window is sized and lifted to fit what's actually visible, so its text box can't end up off-screen. */
(function keyboardFit() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    ROOT.style.setProperty('--kb', kb + 'px');
    ROOT.style.setProperty('--vvh', vv.height + 'px');
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
})();
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (!t || !t.closest || !t.closest('#sheet') || !/^(INPUT|TEXTAREA)$/.test(t.tagName) || /^(range|checkbox|radio|datetime-local)$/.test(t.type)) return;
  setTimeout(() => { try { t.scrollIntoView({ block: 'nearest' }); } catch (err) {} }, 320);
});
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
const MOMENTS = ['Tired', 'Very tired', 'Weak', 'Gassy'];  // Gassy needs HealthLog v15e
const MOMENTS_SINCE = '2026-10-29';
function momentsView() {
  const today = todayEntries().filter((r) => r.kind === 'moment');
  // Tap one to include it with this check-in (the Note below goes with it); tap again to unselect.
  return '<div class="moments" role="group" aria-label="Moment">' + MOMENTS.map((m) => {
    const n = today.filter((r) => String(r.text || '').split(' · ')[0] === m).length;
    return '<button type="button" class="moment-btn" data-act="moment-pick-ci" data-v="' + m + '" aria-pressed="' + S.moment.includes(m) + '">' + m + (n ? '<small>' + n + '</small>' : '') + '</button>';
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
  return '<form id="log-inbox-form" class="mini-inbox" autocomplete="off"><textarea id="log-inbox-text" class="grow" rows="1" data-field="inboxText" placeholder="Add to inbox…" aria-label="Add to inbox" maxlength="2000">' + esc(S.inboxText) +
    '</textarea><button type="submit" class="log">Send</button></form>' +
    '<div id="log-inbox-status" class="mini-status" role="status" aria-live="polite">' + esc(S.inboxStatus || (inboxQueue.length ? 'Waiting to send (' + inboxQueue.length + ')' : '')) + '</div>';
}
/* v39: text boxes marked "grow" (and Today's inbox) get taller as you type, up to half the screen. */
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.5)) + 'px';
}
document.addEventListener('input', (e) => { const t = e.target; if (t && (t.id === 'log-text' || (t.classList && t.classList.contains('grow')))) autoGrow(t); });
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t || t.id !== 'log-inbox-text' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  e.preventDefault(); logInboxSubmit();
});
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
  const el = $('log-inbox-text'); if (el) { el.value = ''; autoGrow(el); }
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
    recent.filter((r) => r.kind === 'meds' && r.hday === hk && notYetInSheet(r) && (r.meds || []).includes(m.name)).length;
}
function quickCount(kind) {
  if (kind === 'meds') {
    // Routine medicines ("Per day" above 0 in Log settings): how many of today's doses are logged, and how many are left.
    const routine = (cfg.meds || []).filter((m) => Number(m.perDay) > 0 && !maxTabs(m));
    // All supplements together count as one daily item.
    const sup = suppList().length ? 1 : 0;
    const total = routine.reduce((t, m) => t + Number(m.perDay), 0) + sup;
    if (!total) return '';
    const done = routine.reduce((t, m) => t + Math.min(medTakenToday(m), Number(m.perDay)), 0) + (sup && suppDoneToday() ? 1 : 0);
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
  const title = { meds: 'Medication', bowel: 'Bowel', food: 'Food', activity: 'Activity', moment: 'Moment', plan: 'Medication plan', edit: 'Edit entry', sleep: S.sleepEdit && S.sleepEdit.mark === 'up' ? 'Out of bed' : 'Into bed' }[S.sheet];
  let body = '', btn = '';
  if (S.sheet === 'meds') {
    const sup = suppList();
    const n = S.meds.length + (S.suppOn && S.supps.length ? 1 : 0);
    btn = '<button type="button" class="log" data-act="meds"' + (n ? '' : ' disabled') + '>' + (n ? 'Log ' + n : 'Log') + '</button>';
    const suppChip = sup.length ? '<button type="button" class="chip med" data-act="supp-toggle" aria-pressed="' + S.suppOn + '"><small class="dose-top">' + sup.length + ' to choose</small><span class="med-name"><b>Supplements</b>' + (suppDoneToday() ? '<span class="taken" aria-label="logged today">✓</span>' : '') + '</span></button>' : '';
    // v39: what's still to take today comes first, then what's done, then the as-needed ones.
    const chip = (m) => '<button type="button" class="chip med" data-act="med" data-v="' + esc(m.name) + '" aria-pressed="' + S.meds.includes(m.name) + '"><small class="dose-top">' + esc(chipDoseTop(m)) + '</small><span class="med-name"><b>' + esc(m.name) + '</b>' + takenMark(m) + '</span></button>';
    const all = cfg.meds || [], hk = healthKey(new Date());
    const nToday = (m) => (((cfg.today || {}).meds || {})[m.name] || 0) + recent.filter((r) => r.kind === 'meds' && r.hday === hk && notYetInSheet(r) && (r.meds || []).includes(m.name)).length;
    const routine = all.filter((m) => Number(m.perDay) !== 0), asNeededMeds = all.filter((m) => Number(m.perDay) === 0);
    const due = routine.filter((m) => nToday(m) < (m.perDay || 1)), done = routine.filter((m) => nToday(m) >= (m.perDay || 1));
    const suppDone = suppDoneToday();
    const head = (t) => '<span class="chip-h">' + t + '</span>';
    const dueHtml = due.map(chip).join('') + (suppDone ? '' : suppChip), doneHtml = done.map(chip).join('') + (suppDone ? suppChip : '');
    body = '<div class="chips med-groups">' + (dueHtml ? head('Still to take today') + dueHtml : '') + (doneHtml ? head('Done today') + doneHtml : '') +
      (asNeededMeds.length ? head('As needed') + asNeededMeds.map(chip).join('') : '') +
      '<button type="button" class="chip other" data-act="other-med">Other…</button></div>' + doseRows() + suppRow() + historyView();
  } else if (S.sheet === 'bowel') {
    btn = '<button type="button" class="log" data-act="bowel"' + (S.bristol ? '' : ' disabled') + '>Log</button>';
    body = bowelBody();
  } else if (S.sheet === 'moment') {
    btn = '<button type="button" class="log" data-act="moment-log"' + (S.moment.length ? '' : ' disabled') + '>Log</button>';
    body = '<div class="chips">' + MOMENTS.map((m) => '<button type="button" class="chip" data-act="moment-pick" data-v="' + m + '" aria-pressed="' + S.moment.includes(m) + '"><b>' + m + '</b></button>').join('') + '</div>' +
      '<input type="text" id="moment-note" data-field="momentNote" value="' + esc(S.momentNote) + '" placeholder="Note (optional)" aria-label="Moment note" autocomplete="off" enterkeyhint="send">' +
      '<p class="small">For moments that stand out. Kept separate from your day scores. Tracking since 29 Oct.</p>';
  } else if (S.sheet === 'sleep') {
    const E = S.sleepEdit || {};
    const place = S.sleepPlace || 'Home';
    const places = E.mark !== 'up' && !E.row ? '<div class="chips sleep-place" role="group" aria-label="Where">' +
      ['Home', "Mara's", 'Other'].map((p) => '<button type="button" class="chip' + (place === p ? ' on' : '') + '" aria-pressed="' + (place === p) + '" data-act="sleep-place" data-v="' + esc(p) + '">' + esc(p) + '</button>').join('') + '</div>' +
      (place === 'Other' ? '<input type="text" class="edit-text" data-field="sleepPlaceOther" maxlength="30" placeholder="Where?" value="' + esc(S.sleepPlaceOther || '') + '">' : '') : '';
    btn = '<button type="button" class="log" data-act="sleep-save"' + (E.busy ? ' disabled' : '') + '>' + (E.row ? 'Save' : 'Log') + '</button>';
    body = '<label class="edit-row"><span>' + (E.mark === 'up' ? 'Got out of bed at' : E.mark === 'lastbed' ? 'Got into bed last night at' : 'Got into bed at') + '</span><input type="time" data-field="sleepTime" value="' + esc(S.sleepTime || '') + '"></label>' + places +
      '<p class="small">' + (E.row ? 'Changes the time already logged.' : E.mark === 'lastbed' ? 'Afternoon/evening times count as yesterday.' : E.mark === 'bed' ? 'Times after midnight count as tonight.' : '') + (E.error ? ' <b>' + esc(E.error) + '</b>' : '') + '</p>';
  } else if (S.sheet === 'edit') {
    // v64: change the time (and the words of a meal, activity or note), or delete. Needs HealthLog v64.
    const E = S.edit || {};
    btn = '<button type="button" class="log" data-act="edit-save"' + (E.busy ? ' disabled' : '') + '>Save</button>';
    body = '<p class="edit-what">' + esc(E.text || '') + '</p>' +
      '<label class="edit-row"><span>Time</span><input type="time" data-field="editTime" value="' + esc(S.editTime || '') + '"></label>' +
      (E.et !== undefined ? '<label class="edit-row"><span>' + (E.kind === 'food' ? 'What you ate' : E.kind === 'activity' ? 'Activity' : 'Note') + '</span><input type="text" data-field="editText" value="' + esc(S.editText || '') + '" autocomplete="off"></label>' : '<p class="small">To change scores or a dose, delete this and log it again.</p>') +
      '<button type="button" class="seg edit-del' + (E.confirm ? ' on' : '') + '" data-act="edit-delete"' + (E.busy ? ' disabled' : '') + '>' + (E.confirm ? 'Tap again to delete' : 'Delete') + '</button>' +
      '<p class="small">Delete keeps the entry in your tracker, marked “Deleted in app”, so nothing is lost.' + (E.error ? ' <b>' + esc(E.error) + '</b>' : '') + '</p>';
  } else if (S.sheet === 'plan') {
    body = planHtml(healthKey(new Date()), false);
  } else if (S.sheet === 'food') {
    btn = '<button type="button" class="log" id="food-log" data-act="food"' + (S.food.trim() || S.foodPhoto ? '' : ' disabled') + '>Log</button>';
    // v56: a camera button; the photo goes to Drive › Meal photo logs and the meal is marked to be interpreted later.
    body = (S.foodPhoto ? '<div class="photo-prev"><img src="' + S.foodPhoto + '" alt="Meal photo"><button type="button" class="icon-btn photo-x" data-act="photo-clear" aria-label="Remove photo">' + X_SVG + '</button></div>' : '') +
      '<div class="food-row"><input type="text" id="food-input" data-field="food" value="' + esc(S.food) + '" placeholder="' + (S.foodPhoto ? 'Add a description (optional)' : 'What did you eat?') + '" aria-label="What did you eat" autocomplete="off" enterkeyhint="send">' +
      '<label class="seg cam-btn" aria-label="Take a photo of the meal">' + CAM_SVG + '<input type="file" id="food-photo" accept="image/*" capture="environment"></label>' +
      // v72: or pick one already taken, from the photo library.
      '<label class="seg cam-btn" aria-label="Choose a photo from your library">' + IMG_SVG + '<input type="file" id="food-photo-lib" accept="image/*"></label></div>' +
      (S.photoBusy ? '<p class="small">Preparing the photo…</p>' : '') +
      '<div class="chips">' + (cfg.foods || []).map((f) => '<button type="button" class="chip food" data-act="food-chip" data-v="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div>';
  } else if (S.sheet === 'activity') {
    btn = '<button type="button" class="log" id="act-log" data-act="activity"' + (actRoute() ? '' : ' disabled') + '>' + (actRoute() === 'inbox' ? 'Send to inbox' : 'Log') + '</button>';
    const chips = (act, list, cur, fmt) => '<div class="chips">' + list.map((x) => '<button type="button" class="chip food" data-act="' + act + '" data-v="' + esc(x) + '" aria-pressed="' + (cur === x) + '">' + esc(fmt ? fmt(x) : x) + '</button>').join('') + '</div>';
    body = '<input type="text" id="act-input" data-field="actText" value="' + esc(S.actText) + '" placeholder="What did you do?" aria-label="What did you do" autocomplete="off" enterkeyhint="send">' +
      '<div class="opt-h">Type</div>' + chips('act-type', ACT_TYPES, S.actType) +
      '<div class="opt-h">Minutes</div>' + chips('act-min', ACT_MINS.map(String), S.actMin === null ? null : String(S.actMin), (x) => (x === '120' ? '120+' : x)).replace(/<\/div>$/, '') +
        '<input type="number" inputmode="numeric" min="1" max="600" id="act-min-custom" class="min-custom" placeholder="Other" aria-label="Other number of minutes" value="' + esc(S.actMinText || (S.actMin && !ACT_MINS.includes(S.actMin) ? String(S.actMin) : '')) + '"></div>' +
      '<div class="opt-h">Effort</div><div class="grid3" role="group" aria-label="Effort">' + ACT_EFFORT.map((e) => '<button type="button" class="seg" data-act="act-effort" data-v="' + e + '" aria-pressed="' + (S.actEffort === e) + '">' + e + '</button>').join('') + '</div>' +
      '<p class="small" id="act-hint">' + actHint() + '</p>';
  }
  const now = new Date();
  const label = S.time ? (dayKey(S.time) === dayKey(now) ? '' : S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(S.time) : 'Now · ' + hm(now);
  if (S.sheet === 'food' || S.sheet === 'activity' || S.sheet === 'bowel') body += todayListHtml(S.sheet);
  const when = S.sheet === 'plan' || S.sheet === 'edit' || S.sheet === 'sleep' ? '' : '<div class="sheet-time">' + timePill(label) + '</div>' + (S.timeOpen ? timePanel(now) : '');
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
  // v39: closing a window drops whatever was selected in it (typed text is kept).
  S.foodPhoto = null; S.meds = []; S.doses = {}; S.suppOn = false; S.supps = []; S.bristol = null; S.size = null; S.urgent = false; S.bpain = '';
  S.actType = null; S.actMin = null; S.actEffort = null; S.actMinText = ''; S.moment = [];
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
  n += recent.filter((r) => r.kind === 'meds' && r.hday === hk && notYetInSheet(r) && (r.meds || []).includes(m.name)).length;
  if (!n) return '';
  const per = m.perDay || 1;
  const asNeeded = isDosed(m);
  const text = !asNeeded && n < per ? n + '/' + per : n > 1 && asNeeded ? '✓' + n : '✓';
  return '<span class="taken" aria-label="' + (n < per && !asNeeded ? n + ' of ' + per + ' logged today' : 'logged today' + (n > 1 ? ', ' + n + ' times' : '')) + '">' + text + '</span>';
}

/* Supplements (Log settings › SUPPLEMENTS): one "Supplements" chip opens a picker, preselected with the
   Default ones; each logs as its own Medication row with the product and dose from the sheet at that moment. */
const suppList = () => (Array.isArray(cfg.supps) ? cfg.supps : []);
function suppDoneToday() {
  const names = suppList().map((x) => x.name);
  if (!names.length) return false;
  const hk = healthKey(new Date());
  return todayEntries().some((r) => (r.kind === 'meds' || r.kind === 'supps') && names.some((n) => String(r.text || '').indexOf(n) === 0 || String(r.text || '').indexOf('Supplements') === 0)) ||
    recent.some((r) => r.kind === 'supps' && r.hday === hk && r.status !== 'failed');
}
function suppRow() {
  if (!S.suppOn) return '';
  return '<div class="dose-row supp-row" role="group" aria-label="Supplements"><span>Supplements</span>' + suppList().map((x) =>
    '<button type="button" class="seg" data-act="supp" data-v="' + esc(x.name) + '" aria-pressed="' + S.supps.includes(x.name) + '"' + (x.detail ? ' title="' + esc(x.detail) + '"' : '') + '>' + esc(x.name) + '</button>').join('') + '</div>';
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
      // v62: how painful it was (tap again to clear).
      '<div class="grid-size grid-pain" role="group" aria-label="Painful">' + [['a bit', 'A bit painful'], ['very', 'Very painful']].map(([k, l]) =>
        '<button type="button" class="seg" data-act="bpain" data-v="' + k + '" aria-pressed="' + (S.bpain === k) + '">' + l + '</button>').join('') + '</div>' +
      '<input type="text" data-field="bowelNote" value="' + esc(S.bowelNote) + '" placeholder="Note (optional)" aria-label="Bowel note" autocomplete="off">' : '');
}

function logMoreRender() {
  const more = $('log-more');
  if (!more) return;
  if (!more.dataset.built) {
    more.dataset.built = '1';
    more.innerHTML = '<div class="tv"><div class="recent-buttons"><button id="toggle-medication" type="button" aria-expanded="false" aria-controls="medications">Recent meds</button>' +
      '<button id="toggle-log-inbox" type="button" aria-expanded="false" aria-controls="log-recent-logs">Recent inbox entries</button></div>' +
      '<div id="medications" aria-live="polite" hidden></div><div id="log-recent-logs" aria-live="polite" hidden></div></div>';
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
  const n = Object.keys(S.scores).length + ((S.period || guessPeriod()) === 'Wake' ? Object.values(S.sleepT).filter(Boolean).length + WAKE_FLAGS.filter(([k]) => S.wakeFlags[k]).length : 0) + (S.moment.length ? 1 : 0);
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

async function editSend(op) {
  const E = S.edit;
  if (!E || E.busy) return;
  const body = { action: 'log', edit: true, op, row: E.row, t: E.t };
  if (op === 'save') {
    if (/^\d{2}:\d{2}$/.test(S.editTime || '') && S.editTime !== E.hm) body.time = S.editTime;
    if (E.et !== undefined && S.editText.trim() && S.editText.trim() !== String(E.et).trim()) body.text = S.editText.trim();
    if (!body.time && !body.text) { S.edit = null; closeSheet(); return; }
  }
  E.busy = true; E.error = ''; logRender();
  let res = null;
  try { res = await api(body); } catch (e) { res = null; }
  if (res && res.success) {
    S.edit = null; closeSheet(); toast(op === 'delete' ? 'Deleted' : 'Saved');
    try { await logRefreshConfig(); } catch (e) { /* the list catches up on the next refresh */ }
    logRender();
  } else {
    E.busy = false; E.confirm = false;
    E.error = !navigator.onLine ? 'Needs a connection.' : res && /unknown|kind/i.test(String(res.error)) ? 'Needs the HealthLog v64 update.' : res && res.error ? res.error : 'Didn’t save. Try again.';
    logRender();
  }
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
  const asked = Date.now();  // v77: cfg.at = when the sheet was asked, so only entries saved before that count as in it
  try {
    const res = await api(SHARE_ID ? { action: 'config', visit: !SHR.visitSent } : { action: 'config' });
    if (SHARE_ID && res && res.success) { SHR.visitSent = true; SHR.loadError = ''; }
    if (SHARE_ID && res && !res.success && res.auth !== false) SHR.loadError = res.error || 'No answer.';
    if (res && res.success) {
      cfg = { meds: res.meds || FALLBACK.meds, foods: res.foods || [], trial: res.trial || null, history: res.history || null, symptoms: res.symptoms || null, recentMeds: res.recentMeds,
        supps: res.supps || [], todayLog: res.todayLog, todayHday: healthKey(new Date()), at: asked, plan: res.plan || null, suppPlan: res.suppPlan || null, episodes: res.episodes || [], share: res.share || null, clarity: !!res.clarity, today: res.today || FALLBACK.today };
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
  } catch (e) { if (SHARE_ID) SHR.loadError = 'no connection to Google'; }
  return false;
}

function logAct(el) {
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'sheet') { openSheet(v); return; }
  if (act === 'moment-open') { S.moment = [v]; S.momentNote = ''; openSheet('moment'); return; }
  if (act === 'moment-pick' || act === 'moment-pick-ci') { S.moment = S.moment.includes(v) ? S.moment.filter((x) => x !== v) : S.moment.concat(v); logRender(); return; }  // v62: several at once
  if (act === 'ring-off') { S.ringOff = !S.ringOff; logRender(); return; }
  if (act === 'wake-flag') { S.wakeFlags[v] = !S.wakeFlags[v]; logRender(); return; }
  if (act === 'moment-log') {
    const picked = S.moment.filter((m) => MOMENTS.includes(m));
    if (!picked.length) return;
    const note = S.momentNote.trim(), at = S.time;
    picked.forEach((m) => { S.time = at; commit('moment', { moment: m, note }, m + (note ? ' · ' + note : '')); });
    S.moment = []; S.momentNote = ''; closeSheet();
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
  if (act === 'logged-toggle') { S.loggedOpen = !S.loggedOpen; logRender(); return; }
  if (act === 'today-all') { S.todayAll = S.todayAll === v ? null : v; logRender(); return; }
  if (act === 'refresh') {
    if (S.refreshing) return;
    S.refreshing = true; logRender();
    Promise.all([logRefreshConfig(), sleepMs(600)]).then(([ok]) => { S.refreshing = false; logRender(); if (!ok) toast('Couldn’t refresh (offline?)'); logFlush(); });
    return;
  }
  if (act === 'act-type') { S.actType = S.actType === v ? null : v; logRender(); return; }
  if (act === 'act-min') { S.actMin = S.actMin === Number(v) ? null : Number(v); S.actMinText = ''; logRender(); return; }
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
  else if (act === 'period') { S.period = v; if (v !== 'Bed') delete S.scores.stress; if (v !== 'Wake' || (S.stage || guessStage()) === 'up') { delete S.scores.sleepq; delete S.scores.disturb; } logRender(); }
  else if (act === 'stage') { S.stage = v; if (v === 'up') { delete S.scores.sleepq; delete S.scores.disturb; } logRender(); }
  else if (act === 'bristol') { S.bristol = S.bristol === Number(v) ? null : Number(v); logRender(); }
  else if (act === 'size') { S.size = S.size === v ? null : v; logRender(); }
  else if (act === 'urgent') { S.urgent = !S.urgent; logRender(); }
  else if (act === 'bpain') { S.bpain = S.bpain === v ? '' : v; logRender(); }
  else if (act === 'med') {
    if (S.meds.includes(v)) { S.meds = S.meds.filter((x) => x !== v); delete S.doses[v]; }
    else {
      S.meds = S.meds.concat(v);
      const m = (cfg.meds || []).find((x) => x.name === v);
      if (m && isDosed(m)) S.doses[v] = { s: medOptions(m)[0], n: maxTabs(m) };
    }
    logRender();
  }
  else if (act === 'supp-toggle') {
    S.suppOn = !S.suppOn;
    S.supps = S.suppOn ? suppList().filter((x) => x.def).map((x) => x.name) : [];
    logRender();
  }
  else if (act === 'supp') { S.supps = S.supps.includes(v) ? S.supps.filter((x) => x !== v) : suppList().map((x) => x.name).filter((x) => S.supps.includes(x) || x === v); logRender(); }
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
  else if (act === 'edit-open') {
    const e = todayEntries().find((x) => String(x.row) === String(v));
    if (!e) return;
    S.edit = { row: e.row, t: e.t, kind: e.kind, text: e.text, hm: e.hm, et: e.et };
    S.editTime = e.hm || ''; S.editText = e.et || '';
    openSheet('edit');
  }
  else if (act === 'edit-save') { editSend('save'); }
  else if (act === 'sleep-open') {
    const mk = sleepMarks()[v], now = new Date();
    S.sleepEdit = { mark: v, row: mk && mk.row ? mk.row : null, t: mk ? mk.t : null, hm: mk ? mk.hm : '' };
    S.sleepTime = mk ? mk.hm : pad(now.getHours()) + ':' + pad(now.getMinutes());
    S.sleepPlace = LS.get('sleepPlace', 'Home'); S.sleepPlaceOther = LS.get('sleepPlaceOther', '');
    if (S.sleepPlace !== 'Home' && Date.now() - LS.get('sleepPlaceAt', 0) > 20 * 3600000) S.sleepPlace = 'Home';  // somewhere else is remembered for one night only
    openSheet('sleep');
  }
  else if (act === 'sleep-place') { S.sleepPlace = v; logRender(); }
  else if (act === 'sleep-save') {
    const E = S.sleepEdit;
    if (!E || !/^\d{2}:\d{2}$/.test(S.sleepTime || '')) return;
    if (E.row) {
      if (S.sleepTime === E.hm) { closeSheet(); return; }
      S.edit = { row: E.row, t: E.t, kind: 'checkin', text: '', hm: E.hm };
      S.editTime = S.sleepTime; S.editText = '';
      E.busy = true; logRender();
      editSend('save').then(() => { if (S.edit) { E.busy = false; E.error = S.edit.error || 'Didn’t save. Try again.'; S.edit = null; logRender(); } else S.sleepEdit = null; });
      return;
    }
    const d = sleepSlotDate(E.mark, S.sleepTime);
    if (d.getTime() > Date.now() + 5 * 60000) { E.error = 'That time hasn’t happened yet.'; logRender(); return; }
    let place = '';
    if (E.mark !== 'up') {
      place = S.sleepPlace === 'Other' ? (S.sleepPlaceOther || '').trim().slice(0, 30) : S.sleepPlace === "Mara's" ? "Mara's" : 'home';
      LS.set('sleepPlace', S.sleepPlace || 'Home'); LS.set('sleepPlaceAt', Date.now());
      if (S.sleepPlace === 'Other') LS.set('sleepPlaceOther', place);
    }
    S.time = d;
    const label = (E.mark === 'up' ? 'Out of bed ' : E.mark === 'lastbed' ? 'Into bed (last night) ' : 'Into bed ') + S.sleepTime + (place && place !== 'home' ? ' · ' + place : '');
    commit('sleepmark', place ? { mark: E.mark === 'up' ? 'up' : 'bed', place } : { mark: E.mark === 'up' ? 'up' : 'bed' }, label,
      { sleepSlot: E.mark, sleepK: healthKey(new Date()), place, up: E.mark === 'up' });
    S.sleepEdit = null; closeSheet();
  }
  else if (act === 'edit-delete') {
    if (!S.edit) return;
    if (!S.edit.confirm) { S.edit.confirm = true; logRender(); return; }
    editSend('delete');
  }
  else if (act === 'bowel') {
    if (!S.bristol) return;
    const label = 'Bristol ' + S.bristol + (S.size ? ' · ' + S.size.toLowerCase() : '') + (S.urgent ? ' · urgent' : '') + (S.bpain ? ' · ' + S.bpain + ' painful' : '');
    commit('bowel', { bristol: S.bristol, size: S.size || '', urgent: S.urgent, pain: S.bpain, note: S.bowelNote.trim() }, label);
    S.bristol = null; S.size = null; S.urgent = false; S.bpain = ''; S.bowelNote = ''; closeSheet();
  }
  else if (act === 'meds') {
    const sup = S.suppOn ? S.supps.slice() : [];
    if (!S.meds.length && !sup.length) return;
    const at = S.time;
    if (sup.length) {
      const due = suppList().filter((x) => x.def).length;
      commit('supps', { supps: sup, due }, 'Supplements: ' + sup.join(', '), { supps: sup, due });
      S.time = at;
    }
    S.suppOn = false; S.supps = [];
    if (!S.meds.length) { closeSheet(); return; }
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
    const food = S.food.trim(), photo = S.foodPhoto;
    if (!food && !photo) return;
    if (photo) commit('food', { food, photo }, 'Meal photo' + (food ? ' · ' + food : ''));
    else commit('food', { food }, food);
    S.food = ''; S.foodPhoto = null; closeSheet();
  }
  else if (act === 'photo-clear') { S.foodPhoto = null; logRender(); }
  else if (act === 'checkin') {
    const period = S.period || guessPeriod();
    const stage = period === 'Wake' ? (S.stage || guessStage()) : '';
    const times = period === 'Wake' ? Object.fromEntries(Object.entries(S.sleepT).filter(([, v]) => /^\d{2}:\d{2}$/.test(v))) : {};
    const n = Object.keys(S.scores).length, t = Object.keys(times).length;
    const mos = S.moment.filter((m) => MOMENTS.includes(m));
    const fl = period === 'Wake' ? WAKE_FLAGS.filter(([k]) => S.wakeFlags[k]).length : 0;  // v62: a flag alone still saves
    if (!n && !t && !mos.length && !fl) return;
    const note = S.checkNote.trim(), at = S.time;
    // Each moment is its own entry (kept out of day scores); the note goes with each.
    mos.forEach((mo) => { S.time = at; commit('moment', { moment: mo, note }, mo + (note ? ' · ' + note : '')); S.time = at; });
    if (!n && !t && !fl) { S.moment = []; S.checkNote = ''; S.open = false; S.period = null; S.stage = null; S.sleepT = { bed: '', wake: '', up: '' }; logRender(); return; }
    const tl = [times.bed ? 'slept ' + times.bed : '', times.wake ? 'woke ' + times.wake : '', times.up ? 'up ' + times.up : ''].filter(Boolean).join(', ');
    const word = stage === 'up' ? 'getting up' : stage === 'bed' ? 'in bed' : period.toLowerCase();
    // Receivers before HealthLog v13 only know "fog" (10 = heavy fog), so send that too until it's updated.
    const sc = Object.assign({}, S.scores);
    if (typeof sc.clarity === 'number') sc.fog = 10 - sc.clarity;
    const flags = period === 'Wake' ? WAKE_FLAGS.filter(([k]) => S.wakeFlags[k]).map(([, , t]) => t) : [];
    const ciNote = (flags.length ? 'Morning: ' + flags.join('; ') + (S.checkNote.trim() ? '. ' : '') : '') + S.checkNote.trim();
    S.wakeFlags = {};
    commit('checkin', { period, stage, scores: sc, note: ciNote, sleep: times },
      'Check-in (' + word + ')' + (n ? ' · ' + n + (n === 1 ? ' rating' : ' ratings') : '') + (tl ? ' · ' + tl : '') + (flags.length ? ' · ' + flags.map((f) => f.replace(' on waking: yes', '')).join(', ') : ''), { wake: period === 'Wake' && stage === 'bed', up: period === 'Wake' && stage === 'up', period });
    S.scores = {}; S.checkNote = ''; S.moment = []; S.open = false; S.period = null; S.stage = null; S.sleepT = { bed: '', wake: '', up: '' }; logRender();
  }
  else if (act === 'trial') {
    const t = cfg.trial;
    if (!t) return;
    commit('trial', {}, t.button.replace(/ now$/i, ''));
  }
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t && t.classList && t.classList.contains('time-overlay') && t.showPicker) { try { t.showPicker(); } catch (e) {} }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t && t.classList && t.classList.contains('time-overlay')) {
    // v40: changing the hour or the date no longer closes the picker: the label updates in place and the
    // page re-draws only when you leave the picker.
    let d = null;
    if (t.type === 'time') {
      const m = /^(\d{2}):(\d{2})$/.exec(t.value || '');
      if (m) {
        const ref = S.time && S.time.getTime() <= Date.now() + 10 * 60000 ? new Date(S.time) : new Date();
        d = new Date(ref); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        if (!S.time && d.getTime() > Date.now() + 10 * 60000) d.setDate(d.getDate() - 1);  // after midnight, 23:30 means last night
      }
    } else d = t.value ? new Date(t.value) : null;
    if (d && !isNaN(d) && d.getTime() <= Date.now() + 10 * 60000 && d.getTime() >= Date.now() - 3 * 86400000) {
      S.time = d; S.timeOpen = false; S.timeDirty = true;
      const lab = t.closest('.time-pick-wrap') && t.closest('.time-pick-wrap').querySelector('.time-pick');
      if (lab) { lab.classList.add('set'); [...lab.childNodes].forEach((n) => { if (n.nodeType === 3) n.textContent = (dayKey(d) === dayKey(new Date()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(d); }); }
    } else S.timeBad = true;
    return;
  }
  if (ev.target.id !== 'time-input') return;
  const d = ev.target.value ? new Date(ev.target.value) : null;
  if (d && !isNaN(d) && d.getTime() <= Date.now() + 10 * 60000 && d.getTime() >= Date.now() - 3 * 86400000) { S.time = d; S.timeOpen = false; logRender(); toast('Next entry will be logged at ' + hm(d)); }
  else if (d) toast('Pick a time in the last 3 days');
});

document.addEventListener('focusout', (ev) => {
  const t = ev.target;
  if (!(t && t.classList && t.classList.contains('time-overlay'))) return;
  // Re-draw a moment later, so a tap on Log straight after picking still lands.
  if (S.timeDirty) { S.timeDirty = false; S.timeBad = false; toast('Next entry will be logged at ' + hm(S.time)); setTimeout(() => { if (!typingInLog()) logRender(); }, 350); }
  else if (S.timeBad) { S.timeBad = false; toast('Pick a time in the last 3 days'); setTimeout(logRender, 350); }
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
  } else if (el.id === 'act-min-custom') {
    // v39: any number of minutes (1–600) instead of the chips.
    S.actMinText = el.value;
    const n = Math.round(Number(el.value));
    S.actMin = n >= 1 && n <= 600 ? n : null;
    document.querySelectorAll('#sheet [data-act="act-min"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    updateActButton(); const h = $('act-hint'); if (h) h.textContent = actHint();
  } else if (el.dataset.field) {
    S[el.dataset.field] = el.value;
    if (el.dataset.field === 'food') { const b = $('food-log'); if (b) b.disabled = !el.value.trim() && !S.foodPhoto; }
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
  return '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' +
      '<a class="icon-btn" href="https://app.todoist.com/app/today" target="_blank" rel="noopener" aria-label="Open Todoist">' + TODOIST_SVG + '</a>' +
      (SHOW_GPT_BUTTON ? '<a class="icon-btn" href="' + GPT_URL + '" target="_blank" rel="noopener" aria-label="Open Life HQ GPT">' + GPT_SVG + '</a>' : '') +
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
    '<section class="optional-section"><button id="toggle" type="button" aria-expanded="false" aria-controls="optional">If there’s time</button>' +
      '<div id="optional" hidden><h2 class="task-tier">If there’s time</h2><div id="extra"></div></div></section>' +
    '<section id="logging" class="lower-section" aria-label="Inbox"><form id="log-form">' +
      '<textarea id="log-text" aria-label="Add something to your inbox" rows="2" maxlength="20000" placeholder="Add to inbox…"></textarea>' +
      '<div class="logging-actions"><button id="save-log" type="submit">Add to inbox</button></div>' +
      '<div id="log-status" class="status" role="status" aria-live="polite"></div></form>' +
      '<div id="inbox-queue" class="queue-note" hidden></div></section>' +
    '<section id="recent-section" class="lower-section"><div class="recent-buttons">' +
      '<button id="toggle-logs" type="button" aria-expanded="false" aria-controls="recent-logs">Recent inbox entries</button></div>' +
      '<div id="recent-logs" aria-live="polite" hidden></div></section>' +
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
    $('toggle').textContent = showing ? 'Hide' : 'If there’s time';
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
  // v76: no "from Tue" tag on unfinished tasks from earlier days (it made low-stakes tasks feel late).
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

/* Unfinished tasks from earlier days show on the normal Today view (untagged since v76). Nothing is moved in Todoist. */
function carriedTasks() {
  if (!T.carry || T.manual || T.loadedDate !== londonWorkingDay(T.rolloverMinutes)) return [];
  const have = new Set(T.tasks.map((t) => t.id));
  return T.carry.filter((t) => !have.has(t.id) && !T.carryDone.has(t.id));
}
async function loadCarryOver() {
  if (!Conn.paired() || T.manual) return;
  const saved = LS.get('cache.carry', null);
  if (saved && !T.carry) { T.carry = saved.tasks; T.prio = saved.prio || {}; renderTasks(); }
  try {
    const res = await dash('getCarryOver', []);
    T.carry = (res && res.tasks) || [];
    T.prio = (res && res.prio) || {};
    LS.set('cache.carry', { at: Date.now(), tasks: T.carry, prio: T.prio });
    renderTasks();
  } catch (e) {}
}

/* v76/v78: "Priority" = tasks with Todoist's red flag (P1; priority 4 in Todoist's data), however many; then the
   rest ("Then"), P2 above P3 above unflagged; optional ones fold under "If there's time". Priorities come with
   getCarryOver (Optional-tasks v76); without them the list is one block in the plan's order, as before. */
const taskPrio = (t) => Number(t.priority || (T.prio && T.prio[t.id]) || 1);
const isTop = (t) => taskPrio(t) === 4;
function renderTasks() {
  $('focus').replaceChildren(); $('extra').replaceChildren();
  const all = T.tasks.concat(carriedTasks());
  // A red flag wins over the optional label: a P1 task shows under Priority even if it's labelled optional.
  const top = T.manual ? [] : all.filter(isTop);
  let core = all.filter((t) => !t.optional || top.indexOf(t) >= 0);
  const extra = all.filter((t) => t.optional && top.indexOf(t) < 0);
  if (!T.manual) core = core.map((t, i) => [t, i]).sort((a, b) => taskPrio(b[0]) - taskPrio(a[0]) || a[1] - b[1]).map((x) => x[0]);
  if (top.length) {
    const head = (txt) => { const h = document.createElement('h2'); h.className = 'task-tier'; h.textContent = txt; return h; };
    $('focus').appendChild(head('Priority'));
    top.forEach((t) => $('focus').appendChild(taskRow(t)));
    core = core.filter((t) => top.indexOf(t) < 0);
    if (core.length) $('focus').appendChild(head('Then'));
  }
  core.forEach((t) => $('focus').appendChild(taskRow(t)));
  extra.forEach((t) => $('extra').appendChild(taskRow(t)));
  if (!core.length && !top.length) $('focus').textContent = 'Nothing selected for this day.';
  if (!extra.length) $('extra').textContent = 'Nothing extra today.';
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
    (name === 'ahead' ? '<a class="icon-btn" href="https://app.todoist.com/app/upcoming" target="_blank" rel="noopener" aria-label="Open Todoist">' + TODOIST_SVG + '</a>' : '') +
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
    const h = document.createElement('h3'); h.className = 'optional-title'; h.textContent = 'Optional this week'; panel.appendChild(h);
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
function moneyEnter() { pageEnter('money', 'Money', 'money-panel', '', loadMoney, 'moneyAt'); }

function loadNextFewDays() {
  const panel = $('next-days');
  return panelLoad('getNextFewDays', 'next-days', (result) => {
    panel.replaceChildren();
    [result.calendarError, result.tasksError].filter(Boolean).forEach((error) => {
      const w = document.createElement('p'); w.className = 'status'; w.textContent = error; panel.appendChild(w);
    });
    result.days.forEach((day, di) => {
      // v49: each day is its own card: weekday large, date small, "Tomorrow" / "In 2 days", and a count.
      const block = document.createElement('section'); block.className = 'ahead-day' + (di === 0 ? ' first' : '');
      const parts = String(day.label || '').split(' ');
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(day.date || '') ? day.date : '';
      const ahead = iso ? Math.round((keyToDate(iso) - keyToDate(dayKey(new Date()))) / 86400000) : di + 1;
      const rel = ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : 'In ' + ahead + ' days';
      const nEv = day.calendar.length, nTk = day.tasks.length + day.deadlines.length;
      const heading = document.createElement('h3'); heading.className = 'ad-head';
      heading.innerHTML = '<span class="ad-day">' + esc(parts[0] || day.label) + '</span><span class="ad-date">' + esc(parts.slice(1).join(' ')) + '</span>' +
        '<span class="ad-rel">' + esc(rel) + '</span>';
      block.appendChild(heading);
      if (nEv || nTk) { const c = document.createElement('div'); c.className = 'ad-count'; c.textContent = [nEv ? nEv + (nEv === 1 ? ' event' : ' events') : '', nTk ? nTk + (nTk === 1 ? ' task' : ' tasks') : ''].filter(Boolean).join(' · '); block.appendChild(c); }
      const group = (label, items, calendar) => {
        if (!items.length) return;
        items.forEach((item) => {
          const row = document.createElement('div'); row.className = 'ahead-row' + (calendar ? ' ad-event' : '');
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
// v51: short one-line quotes and short names.
const CELEBRATION = { figures: ['Dean Gaffney', 'Les Dennis', 'Rustie Lee', 'Cheryl Baker', 'Timmy Mallett', 'Pat Sharp', 'Su Pollard', 'Keith Chegwin', 'Paul Chuckle', 'Emmy Noether', 'Lise Meitner', 'Oliver Heaviside', 'Caroline Herschel', 'Wendy Cope', 'Ivor Cutler', 'Stevie Smith', 'Maureen Crumb', 'Yuri Spatula', 'Doreen Puddle', 'Prof. Len Fidget', 'Dr Enid Biscuit', 'Beryl Quince'],
  lines: ['Assume a spherical biscuit.', 'Carry the imaginary pigeon.', 'Hence, magnificent.', 'QED, darling.', 'The crumpet is yours.', 'The ducks approve.', 'Therefore, onwards.', 'One less thing.', 'Square the tiny victory.', 'Solve for mild thunder.', 'Proceed diagonally.', 'Factorise your trousers.', 'Done is a vibe.', 'Tick. Tock. Ticked.', 'Small win, big hat.', 'Let triumph be triangular.'] };
let lastRewardFigure = '';
function closeReward() {
  clearTimeout(rewardTimer);
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
  caption.textContent = '“' + pick(CELEBRATION.lines) + '”';
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
  // v51: closes by itself after 5 seconds (the task is sent then, unless Undo was pressed).
  clearTimeout(rewardTimer); rewardTimer = setTimeout(() => { if (!$('reward').hidden) closeReward(); }, 5000);
}
let rewardTimer = 0;

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
  { k: 'h', name: 'Headache', color: '#e0679a', dash: '1 4' },
  { k: 'm', name: 'Mood', color: '#8d6e3f', dash: '4 2', inv: true }  // stored as 10 − mood (higher = worse); shown as mood
];
/* Tuning: how far from usual counts as better / worse / much worse, and the evidence needed.
   Tested on 4–28 Oct: averaging pain, stiffness and fatigue hides single-symptom bad days (a fatigue day
   with pain lower than usual averages out), so a day is "worse" when any chosen symptom is well above its
   own usual, or the average is. Roughly 1 day in 5 comes out worse with these numbers. */
// Compare steps is hidden until there are finished steps worth comparing; it reappears on its own from this date.
const COMPARE_FROM = '2026-12-01';
const USUAL_DAYS = 28, USUAL_MIN = 5, MIN_READINGS = 2;
const SYM_WORSE = 1.0, SYM_MUCH = 2.0, AVG_WORSE = 0.5, AVG_MUCH = 1.25, AVG_BETTER = -0.75;
const TR = { pgrid: LS.get('trends.pgrid', 'all'), sec: SHARE_ID ? null : LS.get('trends.sec', null), gi: LS.get('trends.gi2', 'both'), at: 0, loading: false, sel: null, ssel: null, med: LS.get('trends.med', null), calScroll: {}, tipEl: null, on: LS.get('trends.on', ['load']), inc: LS.get('trends.inc3', TREND_SYMS.map((x) => x.k)), days: {} };
if (!LS.get('trends.x1', false)) { if (!TR.on.includes('x')) TR.on.push('x'); LS.set('trends.x1', true); }  // v54: stress line on once
// Brain fog and headache are off by default now; move anyone still on the old default.

const incSyms = () => TREND_SYMS.filter((x) => TR.inc.includes(x.k));
const TRENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v16h16"/><path d="m7.5 14.5 3.5-4 3 2.5 5-6"/></svg>';

/* Share mode: password screen and a light visit record (last opened, visits, minutes, taps). */
const SHR = { error: '', visitSent: false, secs: 0, taps: 0, lastTick: Date.now() };
function shareGateHtml() {
  return '<form class="share-gate" id="share-gate" autocomplete="off">' +
    '<input type="password" id="share-pw" class="text-input" placeholder="Enter password" aria-label="Password" autocomplete="current-password" required minlength="8">' +
    (SHR.error ? '<p class="share-err" role="alert">' + esc(SHR.error) + '</p>' : '') +
    '<button type="submit" class="log wide">Open</button></form>';
}
if (SHARE_ID) {
  document.title = 'Ru’s Health and GI Log';
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'share-gate') return;
    e.preventDefault();
    const pw = ($('share-pw') || {}).value || '';
    if (pw.length < 8) return;
    LS.set('sharepw', pw); SHR.error = ''; SHR.visitSent = false; TR.at = 0; trendsRender(); trendsLoad();
  });
  document.addEventListener('click', () => { SHR.taps++; }, true);
  const flush = (final) => {
    const now = Date.now();
    if (document.visibilityState === 'visible' || final) SHR.secs += Math.min(120, (now - SHR.lastTick) / 1000);
    SHR.lastTick = now;
    if (!LS.get('sharepw', '') || !SHR.visitSent || (SHR.secs < 5 && !SHR.taps)) return;
    const body = JSON.stringify({ share: LS.get('sharepw', ''), action: 'seen', secs: Math.round(SHR.secs), taps: SHR.taps });
    SHR.secs = 0; SHR.taps = 0;
    try { fetch(Conn.endpoint(), { method: 'POST', body, keepalive: true, cache: 'no-store' }).catch(() => {}); } catch (e) {}
  };
  setInterval(() => flush(false), 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); else SHR.lastTick = Date.now(); });
}

function trendsEnter() {
  const el = $('trends-view');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = '<div class="top"><span class="eyebrow">LIFE HQ</span><div class="top-actions">' +
      '<button type="button" class="icon-btn" id="trends-refresh" aria-label="Refresh">' + REFRESH_SVG + '</button>' +
      '<button type="button" class="icon-btn" id="trends-settings" aria-label="Settings">' + GEAR + '</button></div></div>' +
      '<h1 class="page-title">' + (SHARE_ID ? 'Ru’s Health and GI Log' : 'Health') + '</h1><div id="trends-body" aria-live="polite"></div>';
    $('trends-refresh').onclick = () => spin($('trends-refresh'), trendsLoad);
    $('trends-settings').onclick = () => openSettings();
    el.addEventListener('click', trendsClick);
    // v62: on phones a tap also sends mouse events; ignore those for a moment so they can't flash a tooltip over the tap.
    el.addEventListener('touchstart', () => { TR.touchAt = Date.now(); }, { passive: true });
    el.addEventListener('mouseover', (e) => { if (Date.now() - (TR.touchAt || 0) < 800) return; const t = e.target.closest && e.target.closest('[data-tip]'); if (t && t !== TR.tipEl) showTip(t); });
    el.addEventListener('mouseout', (e) => { if (Date.now() - (TR.touchAt || 0) < 800) return; const t = e.target.closest && e.target.closest('[data-tip]'); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip(); });
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
  const list = sy.days.map((d, i) => {
    const key = addDays(sy.startKey, i);
    const have = incSyms().filter((x) => typeof symVal(d, x.k) === 'number');
    const load = have.length ? have.reduce((a, x) => a + symVal(d, x.k), 0) / have.length : null;
    const readings = d.c ? Math.max.apply(null, [0].concat(have.map((x) => d.c[x.k] || 0))) : (d.n || 0);
    return { key, d, load, scores: have.length, readings, enough: load !== null && readings >= MIN_READINGS, flag: false };
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
  });
  if (list.some((x) => x.d.pt)) partsScore(list); else markFlares(list);
  const by = {};
  list.forEach((x) => { by[x.key] = x; });
  return { list, by, today, marks: Array.isArray(sy.marks) ? sy.marks : [], means: list.some((x) => x.d.a), parts: list.some((x) => x.d.pt) };
}
/* v63 (job 14): a hard-day score that doesn't depend on how often you log (needs HealthLog v63, which sends each
   day's six symptoms averaged by part: w Wake check-in in bed · m morning · a afternoon · e evening · b Bed check-in).
   - Each reading is compared with your usual for that kind of check-in (in bed on waking, up and about, in bed at
     night): the middle value of the 28 days before. Lying-down readings are never compared with daytime ones.
   - Only up-and-about parts make the score when there are any; in-bed parts are used only on days with nothing else
     ("low confidence").
   - Each part counts once however many check-ins it had. Day score = half the average of the parts + half the worst.
   - Worse at +0.6, much worse at +1.2, or worse when any one symptom is 3+ above usual within a part.
   - Moments are shown, never counted. No readings = no data. A flare = 2+ worse days in a row (one no-data day can
     sit between them); a single much-worse day is a bad day. */
const PART_UP = ['m', 'a', 'e'], PART_KIND = { w: 'W', m: 'U', a: 'U', e: 'U', b: 'B' };
const DAY_WORSE = 0.6, DAY_MUCH = 1.2, PART_SYM_WORSE = 3, DAY_BETTER = -0.75;
function partUsuals(list) {
  // For each day: usual[kind][symptom] from the 28 days before; also per row (w, m, a, e, b) for the grid.
  const ks = TREND_SYMS.map((x) => x.k), all = {};
  const vals = (days, part, k) => { const out = []; days.forEach((y) => { const v = y.d.pt && y.d.pt[part] && y.d.pt[part][k]; if (typeof v === 'number') out.push(v); }); return out; };
  ['w', 'm', 'a', 'e', 'b'].forEach((pt) => ks.forEach((k) => { all[pt + k] = vals(list, pt, k); }));
  const usual = (arr, fall) => (arr.length >= USUAL_MIN ? median(arr) : fall.length >= USUAL_MIN ? median(fall) : null);
  list.forEach((x, i) => {
    const prior = list.slice(Math.max(0, i - USUAL_DAYS), i);
    x.pu = { W: {}, U: {}, B: {}, row: { w: {}, m: {}, a: {}, e: {}, b: {} } };
    ks.forEach((k) => {
      x.pu.W[k] = usual(vals(prior, 'w', k), all['w' + k]);
      x.pu.B[k] = usual(vals(prior, 'b', k), all['b' + k]);
      x.pu.U[k] = usual(PART_UP.reduce((a, pt) => a.concat(vals(prior, pt, k)), []), PART_UP.reduce((a, pt) => a.concat(all[pt + k]), []));
      ['w', 'm', 'a', 'e', 'b'].forEach((pt) => { x.pu.row[pt][k] = usual(vals(prior, pt, k), all[pt + k]); });
    });
  });
}
/* One part's level (mean of the chosen symptoms) and its difference from usual (mean of each symptom's difference). */
function partOf(x, pt, keys, byRow) {
  const v = x.d.pt && x.d.pt[pt];
  if (!v) return null;
  const u = byRow ? x.pu.row[pt] : x.pu[PART_KIND[pt]];
  const have = keys.filter((k) => typeof v[k] === 'number');
  if (!have.length) return null;
  const devs = {};
  have.forEach((k) => { if (u[k] !== null && u[k] !== undefined) devs[k] = v[k] - u[k]; });
  const dl = Object.values(devs);
  return { level: have.reduce((t, k) => t + v[k], 0) / have.length, dev: dl.length ? dl.reduce((t, a) => t + a, 0) / dl.length : null, devs };
}
const PART_NAMES = { w: 'on waking (in bed)', m: 'morning', a: 'afternoon', e: 'evening', b: 'in bed at night' };
function partsLine(x) {
  const keys = incSyms().map((y) => y.k);
  return ['w', 'm', 'a', 'e', 'b'].map((pt) => { const p = partOf(x, pt, keys); return p && p.dev !== null ? PART_NAMES[pt] + ' ' + (p.dev >= 0 ? '+' : '−') + Math.abs(p.dev).toFixed(1) : ''; }).filter(Boolean).join(', ');
}
/* v63 (job 14f): symptoms through the day, in the stomach grid's format. Rows: Wake (in bed) · Morning · Afternoon ·
   Evening · Bed, last 6 weeks; each cell coloured by how far that part was from your usual for that row, so in-bed
   rows aren't pale just because you were lying down. Overall = the chosen symptoms together. */
const SP_ROWS = [['w', 'Wake'], ['m', 'Morning'], ['a', 'Afternoon'], ['e', 'Evening'], ['b', 'Bed']];
function spClass(dev) { return dev === null || dev === undefined ? '' : dev <= -0.75 ? 'hb' : dev < 0.6 ? 'h1' : dev < 1.2 ? 'h2' : dev < 2 ? 'h3' : 'h4'; }
function symPartsView(T2, today) {
  const mode = TREND_SYMS.some((x) => x.k === TR.pgrid) ? TR.pgrid : 'all';
  const keys = mode === 'all' ? incSyms().map((x) => x.k) : [mode];
  const n = 42, W = 360, L = 58, R = 4, rowH = 12, gap = 3, top = 4, sep = 6;
  const bw = (W - L - R) / n;
  const yOf = (r) => top + r * (rowH + gap) + (r >= 1 ? sep : 0) + (r >= 4 ? sep : 0);
  const H = yOf(4) + rowH + 14, first = addDays(today, -(n - 1));
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Symptoms by part of the day, last six weeks">';
  SP_ROWS.forEach(([, name], r) => { svg += '<text x="' + (L - 6) + '" y="' + (yOf(r) + rowH - 2) + '" class="tr-ax" text-anchor="end">' + name + '</text>'; });
  const shown = (k, v) => { const t = TREND_SYMS.find((y) => y.k === k); return t.name.replace('Mental clarity', 'clarity').toLowerCase() + ' ' + (t.inv ? Math.round((10 - v) * 10) / 10 : v); };
  for (let i = 0; i < n; i++) {
    const k = addDays(first, i), x = T2.by[k];
    if (!x || !x.d.pt) continue;
    const bits = [];
    SP_ROWS.forEach(([pt, name], r) => {
      const p = partOf(x, pt, keys, true);
      if (!p) return;
      const cls = spClass(p.dev) || 'h0';
      svg += '<rect x="' + (L + i * bw + 0.5).toFixed(1) + '" y="' + yOf(r) + '" width="' + Math.max(1.5, bw - 1).toFixed(1) + '" height="' + rowH + '" rx="1.5" class="tr-part ' + cls + '"/>';
      const v = x.d.pt[pt];
      bits.push(name.toLowerCase() + ': ' + Object.keys(v).filter((kk) => mode === 'all' || kk === mode).map((kk) => shown(kk, v[kk])).join(', ') + (p.dev !== null ? ' (' + (p.dev >= 0 ? '+' : '−') + Math.abs(p.dev).toFixed(1) + ')' : ''));
    });
    if (bits.length) svg += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (yOf(4) + rowH) + '" class="tr-hit" data-tip="' + esc(longDate(k) + ' · ' + bits.join(' · ')) + '"/>';
  }
  svg += '<text x="' + L + '" y="' + (H - 1) + '" class="tr-ax">' + esc(shortDate(first)) + '</text><text x="' + (W - R) + '" y="' + (H - 1) + '" class="tr-ax" text-anchor="end">' + esc(shortDate(today)) + '</text></svg>';
  const chips = [['all', 'Overall']].concat(TREND_SYMS.map((x) => [x.k, x.name.replace('Mental clarity', 'Clarity')]));
  return '<h2 class="tr-h">Through the day' + infoI('Each cell is one part of a day: Wake = the in-bed check-in on waking, Bed = the in-bed one at night, the rest are up-and-about readings by time (morning to 12:00, afternoon 12–17, evening 17:00 on). Colour = how far that part was from your usual for that row (the 28 days before), so lying-down rows are compared with lying-down readings. Overall = the symptoms chosen under Day by day together. Blank = nothing logged. In brackets: points above (+) or below (−) usual.') + '</h2>' +
    '<div class="tr-chips tr-gichips">' + chips.map(([k, l]) => '<button type="button" class="tr-chip" data-tr="pgrid" data-v="' + k + '" aria-pressed="' + (mode === k) + '">' + esc(l) + '</button>').join('') + '</div>' + svg +
    '<div class="tr-key"><span class="tr-kc"><i class="hb"></i>Better</span><span class="tr-kc"><i class="h1"></i>Usual</span><span class="tr-kc"><i class="h2"></i>A bit worse</span><span class="tr-kc"><i class="h3"></i>Worse</span><span class="tr-kc"><i class="h4"></i>Much worse</span></div>';
}
function partsScore(list) {
  partUsuals(list);
  const keys = incSyms().map((x) => x.k);
  const half = (arr) => (arr.length ? 0.5 * (arr.reduce((t, a) => t + a, 0) / arr.length) + 0.5 * Math.max.apply(null, arr) : null);
  list.forEach((x) => {
    let parts = PART_UP.map((pt) => partOf(x, pt, keys)).filter(Boolean);
    x.low = false;
    if (!parts.length) { parts = ['w', 'b'].map((pt) => partOf(x, pt, keys)).filter(Boolean); x.low = parts.length > 0; }
    x.nParts = parts.length;
    x.load = half(parts.map((p) => p.level));
    x.enough = x.load !== null;
    const devParts = parts.filter((p) => p.dev !== null);
    x.score = half(devParts.map((p) => p.dev));
    x.dev = {};
    parts.forEach((p) => Object.keys(p.devs).forEach((k) => { if (x.dev[k] === undefined || p.devs[k] > x.dev[k]) x.dev[k] = p.devs[k]; }));
    const maxSym = Object.values(x.dev).length ? Math.max.apply(null, Object.values(x.dev)) : null;
    x.cls = x.load === null ? 'none' : x.score === null ? 'thin'
      : x.score >= DAY_MUCH ? 'much' : x.score >= DAY_WORSE || maxSym >= PART_SYM_WORSE ? 'worse' : x.score <= DAY_BETTER && maxSym < 0.5 ? 'better' : 'usual';
  });
  // Usual day level, for the chart's grey line and the "this week" tile.
  list.forEach((x, i) => {
    const prior = list.slice(Math.max(0, i - USUAL_DAYS), i).filter((y) => y.load !== null).map((y) => y.load);
    x.usual = prior.length >= USUAL_MIN ? median(prior) : null;
  });
  // Flares: 2+ worse days in a row; one no-data day may sit between them. A single much-worse day is a bad day.
  const bad = (x) => x && (x.cls === 'worse' || x.cls === 'much');
  list.forEach((x) => { x.flare = false; x.badDay = false; x.fday = false; });
  const eps = [];
  for (let i = 0; i < list.length; i++) {
    if (!bad(list[i])) continue;
    let j = i, cnt = 1;
    while (true) {
      if (bad(list[j + 1])) { j++; cnt++; continue; }
      if (list[j + 1] && list[j + 1].cls === 'none' && bad(list[j + 2])) { j += 2; cnt++; continue; }
      break;
    }
    if (cnt >= 2) {
      const days = list.slice(i, j + 1);
      days.forEach((y) => { y.flare = true; });
      const why = [];
      TREND_SYMS.forEach((sm) => { if (days.some((y) => (y.dev || {})[sm.k] >= 1)) why.push(sm.name.toLowerCase()); });
      eps.push({ from: list[i].key, to: list[j].key, days: j - i + 1, why });
    } else if (list[i].cls === 'much') list[i].badDay = true;
    i = j;
  }
  list.flareEps = eps;
}
/* v32 flares, worked out automatically (nothing marked by hand; "Flare" notes are ignored).
   A flare day is a day much worse than usual, or a Very tired / Weak moment followed by a worse or much-worse
   next day (both days count). A flare is 2+ flare days in a row, plus the worse days either side.
   A single much-worse day on its own is a "bad day" (ring), not a flare. */
function markFlares(list) {
  const bad = (x) => x && (x.cls === 'worse' || x.cls === 'much');
  list.forEach((x) => { x.fday = x.cls === 'much'; x.flare = false; x.badDay = false; });
  list.forEach((x, i) => {
    // You're often tired, so a Very tired / Weak moment only counts when the next day is much worse.
    if ((x.d.mv || x.d.mw) && list[i + 1] && list[i + 1].cls === 'much') { x.fday = true; list[i + 1].fday = true; }
  });
  const eps = [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].fday) continue;
    let a = i, b = i;
    while (b + 1 < list.length && list[b + 1].fday) b++;
    const runEnd = b;
    if (b > a) {
      while (a > 0 && bad(list[a - 1]) && !list[a - 1].flare) a--;
      while (b + 1 < list.length && bad(list[b + 1]) && !list[b + 1].fday) b++;
      const days = list.slice(a, b + 1);
      days.forEach((y) => { y.flare = true; });
      const why = [];
      TREND_SYMS.forEach((sm) => { if (days.some((y) => (y.dev || {})[sm.k] >= SYM_WORSE)) why.push(sm.name.toLowerCase()); });
      if (days.some((y) => y.d.mv)) why.push('very tired');
      if (days.some((y) => y.d.mw)) why.push('weak');
      eps.push({ from: list[a].key, to: list[b].key, days: b - a + 1, why });
      i = b;
    } else { list[i].badDay = true; i = runEnd; }
  }
  list.flareEps = eps;
}
function flareEpisodes(list) { return list.flareEps || []; }
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
  if (SHARE_ID && !Conn.canLog()) { body.innerHTML = shareGateHtml(); return; }
  const T2 = trendsDays();
  if (!T2) {
    if (!Conn.canLog()) body.innerHTML = '<div class="notice">Pair this device once to see your health trends.<button type="button" class="log wide" data-tr="pair">Pair this device</button></div>';
    else if (TR.loading) body.innerHTML = '<p class="small tr-center">Loading…</p>';
    else if (SHARE_ID) body.innerHTML = '<div class="notice">Couldn’t load the log' + (SHR.loadError ? ' (' + esc(SHR.loadError) + ')' : '') + '. Try again in a minute.</div>';
    else body.innerHTML = '<div class="notice">This page needs the receiver update (HealthLog v6). Once it’s deployed, this page fills in by itself.</div>';
    return;
  }
  const { list, by, today } = T2;
  const last = (n, end) => list.filter((x) => x.key <= addDays(today, -end) && x.key > addDays(today, -end - n));
  const l28 = last(28, 0);
  const rough = l28.filter((x) => x.cls === 'worse' || x.cls === 'much').length;
  const eps = flareEpisodes(list).filter((e) => e.to > addDays(today, -28));
  const wkDiff = (() => { const v = last(7, 0).filter((x) => x.enough && x.usual !== null); return v.length ? v.reduce((t, x) => t + x.load - x.usual, 0) / v.length : null; })();
  let dayHtml = '<div class="tr-stats">' +
    '<div class="tr-stat"><span>Rough days</span><b>' + rough + '</b><small>last 4 weeks</small></div>' +
    '<div class="tr-stat"><span>Flares</span><b>' + eps.length + '</b><small>last 4 weeks</small></div>' +
    '<div class="tr-stat"><span>This week</span><b>' + (wkDiff === null ? '–' : Math.abs(wkDiff) < 0.25 ? 'Usual' : (wkDiff > 0 ? '+' : '−') + Math.abs(wkDiff).toFixed(1)) + '</b><small>' + (wkDiff !== null && Math.abs(wkDiff) < 0.25 ? 'about your usual' : 'vs your usual') + '</small></div></div>';

  dayHtml += '<div class="tr-inc"><span>Day score uses</span>' + TREND_SYMS.map((x) => '<button type="button" class="tr-chip" data-tr="inc" data-v="' + x.k + '" aria-pressed="' + TR.inc.includes(x.k) + '">' + esc(x.name) + '</button>').join('') + '</div>';
  // Calendar: scrollable, opens on the latest weeks.
  const CLS = { better: 'hb', usual: 'h1', worse: 'h3', much: 'h4', thin: 'thin' };
  const WORD = { better: 'better than usual', usual: 'about usual', worse: 'worse than usual', much: 'much worse than usual', thin: 'only one reading' };
  const firstData = (list.find((x) => x.load !== null) || {}).key;
  dayHtml += calGrid('health', 'Symptom calendar', firstData, today, (k) => {
    const x = by[k], n = keyToDate(k).getDate();
    const cls = ['tr-cell'];
    if (k === today) cls.push('today');
    if (k === TR.sel) cls.push('sel');
    const mark = x && x.flare ? '<i class="tr-flare"></i>' : x && x.badDay ? '<i class="tr-flare ring"></i>' : '';
    if (x && x.cls !== 'none') {
      cls.push(CLS[x.cls] || 'h1');
      return '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + ', ' + WORD[x.cls] + (x.flare ? ', flare' : x.badDay ? ', bad day' : '') + '">' + n + mark + '</button>';
    }
    cls.push('empty');
    return '<button type="button" class="' + cls.join(' ') + '" data-tr="day" data-v="' + k + '" aria-label="' + esc(longDate(k)) + (x && x.flare ? ', flare' : ', no check-in') + '">' + n + mark + '</button>';
  });
  dayHtml += '<div class="tr-key"><span class="tr-kc"><i class="hb"></i>Better</span><span class="tr-kc"><i class="h1"></i>Usual</span><span class="tr-kc"><i class="h3"></i>Worse</span><span class="tr-kc"><i class="h4"></i>Much worse</span>' +
    '<span><i class="tr-flare inline"></i>Flare</span><span><i class="tr-flare inline ring"></i>Bad day</span></div>';

  // Detail for the chosen day, with its 24-hour strip.
  const sel = TR.sel && TR.sel <= today ? TR.sel : null;
  if (sel) {
    const x = by[sel];
    const vals = x ? TREND_SYMS.filter((sm) => typeof symVal(x.d, sm.k) === 'number').map((sm) => sm.name.toLowerCase() + ' ' + (sm.inv ? Math.round((10 - symVal(x.d, sm.k)) * 10) / 10 : symVal(x.d, sm.k))) : [];
    dayHtml += '<p class="tr-detail"><b>' + esc(longDate(sel)) + '</b> · ' + (x && x.load !== null
      ? (T2.parts && x.score !== null && x.score !== undefined ? 'day ' + (x.score >= 0 ? '+' : '−') + Math.abs(x.score).toFixed(1) + ' vs usual' + (x.low ? ' (in-bed readings only, low confidence)' : '') + ' · ' + partsLine(x) : 'day score ' + x.load.toFixed(1) + (x.usual !== null ? ' (usual ' + x.usual.toFixed(1) + ')' : '')) + (x.flare ? ' · part of a flare' : x.badDay ? ' · bad day' : '') + ' · ' + vals.join(', ') +
        (Object.keys(x.dev || {}).filter((kk) => x.dev[kk] >= SYM_WORSE).length ? ' · above usual: ' + Object.keys(x.dev).filter((kk) => x.dev[kk] >= SYM_WORSE).map((kk) => { const t = TREND_SYMS.find((y) => y.k === kk); return t.name.toLowerCase() + (t.inv ? ' −' : ' +') + x.dev[kk].toFixed(1); }).join(', ') : '') +
        (x.readings ? ' · ' + x.readings + (x.readings === 1 ? ' reading' : ' readings') : '') + (T2.means ? '' : ' · daily highs')
      : (x && x.flare ? 'part of a flare · ' : '') + (sel === today ? 'no check-in yet today' : 'no check-in logged')) + '</p>' + dayStrip(sel);
  }
  if (sel) { const on = episodesOn(sel, today); if (on.length) dayHtml += '<p class="tr-detail ep-day">' + on.map((e) => '<span class="ep-tag">' + esc(e.text) + '</span>').join(' ') + '</p>'; }

  // v37: the symptom chart comes first, with a title; the day-by-day calendar follows.
  // v54: stress is a line on the main chart (0–5 shown on the 0–10 scale, so 5 sits at the top), toggled like a symptom.
  const series = [{ k: 'load', name: 'Overall' }].concat(TREND_SYMS).concat(T2.list.some((x) => giNum(symVal(x.d, 'x'))) ? [{ k: 'x', name: 'Stress', color: '#8a5cc2' }] : []);
  let over = '<h2 class="tr-h tr-h-first tr-h-main">All symptoms' + infoI('The main picture. Overall = ' + (T2.parts ? 'the day’s level for the symptoms chosen under Day by day: up-and-about readings averaged within morning, afternoon and evening, then half the average of those parts + half the worst one, so logging more often doesn’t change it.' : 'the day score: the average of that day’s readings for the symptoms chosen under Day by day.') + ' The dashed grey line is the 7-day average, so you can see the trend. Solid dot = flare day, ring = bad day. Show alongside: Stress (purple dashed; your 0–5 doubled, so 5 = 10) and Activity (teal line, 0–10: activity minutes weighted by effort, light ×1, moderate ×2, hard ×3, plus everyday steps beyond about 3,000 that aren’t already part of a walk; on a curve so a 40-minute walk is about 4 and a big swing night like 5 Nov about 9), on the same 0–10 scale so they line up with the symptoms.') + '</h2>';
  const chip = (s) => '<button type="button" class="tr-chip" data-tr="series" data-v="' + s.k + '" aria-pressed="' + TR.on.includes(s.k) + '">' +
    '<i style="' + (s.k === 'load' ? 'background:var(--ink)' : 'background:' + s.color) + '"></i>' + esc(s.name) + '</button>';
  const symSeries = series.filter((s) => s.k !== 'x');
  const extra = series.filter((s) => s.k === 'x').concat(T2.list.some((x) => actScore(x) !== null) ? [{ k: 'act', name: 'Activity', color: '#2a9d8f' }] : []);
  over += '<div class="tr-chips">' + symSeries.map(chip).join('') + '</div>' +
    (extra.length ? '<div class="tr-chips tr-extra"><span class="tr-extra-l">Show alongside</span>' + extra.map(chip).join('') + '</div>' : '');
  over += trendsChart(T2);
  over += '<h2 class="tr-h">Day by day' + infoI(T2.parts ? 'Each reading is compared with your usual for that kind of check-in (in bed on waking, up and about, in bed at night): the middle value of the ' + USUAL_DAYS + ' days before. The day is split into morning (to 12:00), afternoon (12–17) and evening (17:00 to bed); each part counts once however often you logged. Day = half the average of the parts + half the worst part, using up-and-about readings (in-bed ones only on days with nothing else: low confidence). Worse = +0.6 or more, or any one symptom 3+ above usual in a part; much worse = +1.2. Moments are shown but not counted. Flare (solid dot) = 2+ worse days in a row (a day with no readings can sit between). Bad day (ring) = a single much-worse day. Days run 04:00 to 04:00.' : 'Each day is compared with your usual (the middle value of the ' + USUAL_DAYS + ' days before). Worse = a chosen symptom a point or more above its usual, or the average half a point; much worse = 2+ points, or the average 1.25+. Days need ' + MIN_READINGS + '+ readings to be coloured. Flare (solid dot) = 2+ much-worse days in a row, or a Very tired / Weak moment followed by a much-worse day, joined with worse days either side. Bad day (ring) = a single much-worse day. Days run 04:00 to 04:00.') + '</h2>' + dayHtml;
  if (T2.parts) over += symPartsView(T2, today);
  // v45: Health is split into sections with tabs at the top; only the chosen one is drawn.
  const secs = healthSections();
  const sec = curSection(secs);
  let html = secs.length > 1 ? '<nav class="tr-tabs" aria-label="Health sections">' + secs.map(([k, l]) => '<button type="button" data-tr="sec" data-v="' + k + '" aria-pressed="' + (sec === k) + '">' + l + '</button>').join('') + '</nav>' : '';
  html += sec === 'overall' ? over : sec === 'gut' ? stomachView(T2) : sec === 'sleep' ? sleepView(T2) : sec === 'activity' ? activityView(T2)
    : medsView(today) + (planSteps().length ? '<h2 class="tr-h" id="trials">Trials</h2>' + trialEffectHtml(T2, today) + '<h3 class="tr-trial-h">Trial timeline</h3>' + planHtml(today, today >= COMPARE_FROM, true) : '');
  if (SHARE_ID) html += '<p class="small tr-hint">View-only copy of Ru’s health log. It updates by itself.</p>';
  if (TR.pop) {
    const G = giData();
    const pop = TR.pop === 'stomach' ? (G ? stomachPatterns(G, today) : null) : TR.pop === 'activity' ? activityPatterns(T2) : TR.pop === 'sleep' ? sleepPatterns(T2) : TR.pop === 'steps' ? stepsCompare(T2, today) : TR.pop === 'plan' ? { title: 'Plan steps', html: planHtml(today, false, 'list') } : /^trialfx/.test(TR.pop || '') ? trialEffectPop(T2, today, TR.pop.includes(':') ? Number(TR.pop.split(':')[1]) : undefined) : TR.pop === 'suppplan' ? suppPlanPop() : /^medfx:/.test(TR.pop || '') ? medEffect(T2, TR.pop.slice(6)) : null;
    html += patternsPopup(pop);
    TR.popFresh = false;
  }
  document.body.classList.toggle('sheet-open', !!TR.pop || !!S.sheet);
  hideTip();
  body.innerHTML = html;
  restoreCalScroll(body);
}

/* v45: Health sections. In share mode the receiver says which ones this person may see and where they start. */
const HEALTH_SECS = [['overall', 'Symptoms'], ['gut', 'Gut'], ['sleep', 'Sleep'], ['activity', 'Activity'], ['medication', 'Meds']];
function healthSections() {
  const ok = SHARE_ID && cfg.share && Array.isArray(cfg.share.sections) ? cfg.share.sections : HEALTH_SECS.map(([k]) => k);
  return HEALTH_SECS.filter(([k]) => ok.includes(k));
}
function curSection(secs) {
  const keys = secs.map(([k]) => k);
  if (TR.sec && keys.includes(TR.sec)) return TR.sec;
  const first = SHARE_ID && cfg.share && keys.includes(cfg.share.open) ? cfg.share.open : keys[0];
  return first || 'overall';
}
/* v40: health episodes (colds, eczema flares …) from the Episodes tab, shown on each day and as a list. */
function episodesOn(k, today) {
  return (cfg.episodes || []).filter((e) => e.from <= k && (!e.to || k <= e.to) && k <= today).map((e) => {
    const n = dayNum(e.from, k), len = e.to ? dayNum(e.from, e.to) : null;
    const peak = e.peak && k >= e.peak && k <= (e.peakTo || e.peak);
    return { e, text: e.name + ' · day ' + n + (len ? ' of ' + len : '') + (peak ? ' (peak)' : '') + (!e.to ? ' (ongoing)' : '') };
  });
}
function episodesHtml(today) {
  const eps = (cfg.episodes || []).filter((e) => !e.to || e.to >= addDays(today, -90)).sort((a, b) => (!a.to - !b.to) * -1 || (b.from > a.from ? 1 : -1));
  const info = infoI('Spells that last days or weeks, like a cold or an eczema flare. They come from the health tracker’s Episodes tab; tell Claude or the inbox when one starts, peaks, changes or ends. Tap an episode for its notes; tap a day above to see which were going on.');
  if (!eps.length) return '<h2 class="tr-h">Health episodes' + info + '</h2><p class="small tr-hint">None recorded yet.</p>';
  return '<h2 class="tr-h">Health episodes' + info + '</h2><div class="ep-list">' + eps.map((e) => {
    const len = dayNum(e.from, e.to || today);
    return '<button type="button" class="ep-row' + (e.to ? '' : ' on') + '" data-tip="' + esc((e.notes || e.name) + (e.peak ? ' · peak ' + shortDate(e.peak) + (e.peakTo && e.peakTo !== e.peak ? ' – ' + shortDate(e.peakTo) : '') : '')) + '"><i></i><span><b>' + esc(e.name) + '</b><small>' +
      esc(shortDate(e.from) + (e.to ? ' – ' + shortDate(e.to) + ' · ' + len + ' days' : ' onwards · day ' + len) + (e.peak ? ' · peak ' + shortDate(e.peak) + (e.peakTo && e.peakTo !== e.peak ? '–' + shortDate(e.peakTo) : '') : '')) + '</small></span><em>' + esc(e.status || (e.to ? 'Over' : 'Ongoing')) + '</em></button>';
  }).join('') + '</div>';
}
/* v40: daily stress (0–5) as a small line under the symptom chart (HealthLog v16 sends it). */
function stressChart(T2) {
  const list = T2.list.slice(-42), n = list.length;
  const get = (x) => (giNum(symVal(x.d, 'x')) ? symVal(x.d, 'x') : null);
  if (!list.some((x) => get(x) !== null)) return '';
  const W = 360, L = 22, R = 8, H = 58, TOP = 6, B = 14, ch = H - TOP - B;
  const X = (i) => L + (n > 1 ? (i * (W - L - R)) / (n - 1) : 0), Y = (v) => TOP + ch - (v / 5) * ch;
  let svg = '<div class="tr-sub">Stress (0–5)</div><svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily stress, last six weeks">';
  [0, 5].forEach((v) => { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="tr-grid"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5) + '" class="tr-ax" text-anchor="end">' + v + '</text>'; });
  let d = '', pen = false;  // joins across days without a reading
  list.forEach((x, i) => { const v = get(x); if (v === null) return; d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
  svg += '<path d="' + d + '" fill="none" class="tr-stress"/>';
  const colW = n > 1 ? (W - L - R) / (n - 1) : W;
  list.forEach((x, i) => { const v = get(x); if (v === null) return; svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.2" class="tr-stressdot"/><rect x="' + Math.max(L, X(i) - colW / 2).toFixed(1) + '" y="0" width="' + colW.toFixed(1) + '" height="' + (H - B) + '" class="tr-hit" data-tip="' + esc(longDate(x.key) + ' · stress ' + v + '/5') + '"/>'; });
  return svg + '<text x="' + L + '" y="' + (H - 2) + '" class="tr-ax">' + esc(shortDate(list[0].key)) + '</text><text x="' + (W - R) + '" y="' + (H - 2) + '" class="tr-ax" text-anchor="end">' + esc(shortDate(list[n - 1].key)) + '</text></svg>';
}
function trendsChart(T2) {
  const { marks } = T2;
  // Start the chart at the first logged day (at least the last 14 days) so empty weeks don't squash it.
  const recent42 = T2.list.slice(-42);
  const firstData = recent42.findIndex((x) => x.load !== null);
  const list = recent42.slice(Math.max(0, Math.min(firstData < 0 ? 0 : firstData, recent42.length - 14)));
  // v51: the activity band shows Oura steps once the ring is synced, otherwise logged activity.
  const stepsOf = (x) => (x.d.oura && giNum(x.d.oura.st) ? x.d.oura.st : null);
  const useSteps = false;  // v56: active minutes on this chart, so days before and after the Oura ring compare
  // v52: active minutes, shaded by how hard (light / moderate / hard, from the logged effort).
  const actOf = (x) => (useSteps ? stepsOf(x) || 0 : x.d.am || 0);
  const effortCls = (x) => { const r = x.d.am ? (x.d.al || 0) / x.d.am : 0; return r >= 2.5 ? ' hard' : r >= 1.5 ? ' mod' : ' light'; };
  const hasAct = false;  // v55: activity is now an overlay line (chip "Activity"), not a band
  const BAND = 0;
  // v44: stress (0–5) sits in its own band right under the chart, on the same days.
  const stressOf = (x) => (giNum(symVal(x.d, 'x')) ? symVal(x.d, 'x') : null);
  const SB = 0;
  const W = 360, H = 200 + BAND + SB, L = 22, R = 8, TOP = 28, B = 22 + BAND + SB;
  const n = list.length, cw = W - L - R, ch = H - TOP - B;
  const X = (i) => L + (n > 1 ? (i * cw) / (n - 1) : 0);
  const Y = (v) => TOP + ch - (v / 10) * ch;
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily symptom scores over the last six weeks">';
  for (let v = 0; v <= 10; v += 2) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="tr-grid"/><text x="' + (L - 5) + '" y="' + (Y(v) + 3.5) + '" class="tr-ax" text-anchor="end">' + v + '</text>';
  // Faint weekly guides run through the chart and both bands, so a day lines up all the way down.
  list.forEach((x, i) => { if ((n - 1 - i) % 7 === 0) svg += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + TOP + '" y2="' + (H - 18) + '" class="tr-week"/>'; });
  list.forEach((x, i) => { if ((n - 1 - i) % 7 === 0 && (i > 2 || i === n - 1)) svg += '<text x="' + X(i) + '" y="' + (H - 6) + '" class="tr-ax" text-anchor="' + (i === n - 1 ? 'end' : 'middle') + '">' + esc(shortDate(x.key)) + '</text>'; });
  // v55: trial starts get their labels on alternating rows above the chart, so neighbours don't overlap.
  marks.filter((m) => list.some((x) => x.key === m.key)).forEach((m, k) => {
    const i = list.findIndex((x) => x.key === m.key);
    const right = X(i) > W * 0.55, row = k % 2;
    const label = m.label.length > 26 ? m.label.slice(0, 25) + '…' : m.label;
    svg += '<line x1="' + X(i) + '" x2="' + X(i) + '" y1="' + (TOP - 12 + row * 10) + '" y2="' + (TOP + ch) + '" class="tr-mark"/><text x="' + (X(i) + (right ? -3 : 3)) + '" y="' + (TOP - 14 + row * 10) + '" class="tr-ax tr-marklabel" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(label) + '</text>';
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
  // v66: activity score (0–10) as a line: effort-weighted activity minutes plus everyday steps (see actScore).
  if (TR.on.includes('act')) {
    let ad = '', pen = false;
    list.forEach((x, i) => { const v = actScore(x); if (v === null) { pen = false; return; } ad += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    svg += '<path d="' + ad + '" fill="none" class="tr-act-line"/>' + list.map((x, i) => (actScore(x) === null ? '' : '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(actScore(x)).toFixed(1) + '" r="1.8" class="tr-actdot"/>')).join('');
  }
  if (TR.on.includes('x')) {
    const sg = (x) => (stressOf(x) === null ? undefined : stressOf(x) * 2);
    let sd = '';
    list.forEach((x, i) => { const v = sg(x); if (v !== undefined) sd += (sd ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
    svg += '<path d="' + sd + '" fill="none" class="tr-stress-line"/>' + list.map((x, i) => (sg(x) === undefined ? '' : '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(sg(x)).toFixed(1) + '" r="2" class="tr-stressdot"/>')).join('');
  }
  // 7-day average of the day score (needs 3+ scored days in the window).
  const full = T2.list, off = full.length - list.length;
  const avg7 = list.map((x, i) => { const w = full.slice(Math.max(0, off + i - 6), off + i + 1).map((y) => y.load).filter((v) => typeof v === 'number'); return w.length >= 3 ? w.reduce((a, v) => a + v, 0) / w.length : null; });
  if (TR.on.includes('load')) svg += '<path d="' + path((x) => avg7[list.indexOf(x)]) + '" fill="none" class="tr-avg"/>';
  if (TR.on.includes('load')) {
    const get = (x) => x.load;
    svg += '<path d="' + path(get) + '" fill="none" class="tr-load"/>' + dots(get, 'tr-loaddot');
    list.forEach((x, i) => { if ((x.flare || x.badDay) && x.load !== null) svg += '<circle cx="' + X(i) + '" cy="' + Y(x.load) + '" r="3.6" class="tr-flaredot' + (x.flare ? '' : ' ring') + '"/>'; });
  }
  if (SB) {
    const top = TOP + ch + 20, hgt = SB - 22, sy = (v) => top + hgt - (v / 5) * hgt;
    svg += '<text x="' + (L + 2) + '" y="' + (top - 2) + '" class="tr-band">Stress · 0–5</text><text x="' + (L - 5) + '" y="' + (top + 3.5) + '" class="tr-ax" text-anchor="end">5</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + (top + hgt) + '" y2="' + (top + hgt) + '" class="tr-grid"/><line x1="' + L + '" x2="' + (W - R) + '" y1="' + top + '" y2="' + top + '" class="tr-grid"/>';
    let d = '', pen = false;
    list.forEach((x, i) => { const v = stressOf(x); if (v === null) return; d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + sy(v).toFixed(1); pen = true; });
    svg += '<path d="' + d + '" fill="none" class="tr-stress"/>' + list.map((x, i) => { const v = stressOf(x); return v === null ? '' : '<circle cx="' + X(i).toFixed(1) + '" cy="' + sy(v).toFixed(1) + '" r="1.9" class="tr-stressdot"/>'; }).join('');
  }
  // Activity load as thin bars under the chart, on the same days.
  if (hasAct) {
    const max = Math.max.apply(null, list.map(actOf));
    const top = TOP + ch + 12 + SB, hgt = BAND - 14, bwid = Math.max(2, Math.min(8, (cw / Math.max(1, n - 1)) * 0.6));
    svg += '<text x="' + (L + 2) + '" y="' + (top - 2) + '" class="tr-band">' + (useSteps ? 'Steps (Oura)' : 'Active minutes') + '</text><text x="' + (L - 5) + '" y="' + (top + 3.5) + '" class="tr-ax" text-anchor="end">' + (useSteps ? '' : Math.round(max)) + '</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + (top + hgt) + '" y2="' + (top + hgt) + '" class="tr-grid"/>';
    list.forEach((x, i) => {
      const v = actOf(x);
      if (!v) return;
      const h = Math.max(1.5, (v / max) * hgt);
      svg += '<rect x="' + (X(i) - bwid / 2).toFixed(1) + '" y="' + (top + hgt - h).toFixed(1) + '" width="' + bwid.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1" class="tr-actbar' + (useSteps ? '' : effortCls(x)) + '"/>';
    });
  }
  // Hover / tap areas, one per day.
  const colW = n > 1 ? cw / (n - 1) : cw;
  list.forEach((x, i) => {
    const vals = TREND_SYMS.filter((sm) => typeof symVal(x.d, sm.k) === 'number').map((sm) => sm.name.toLowerCase() + ' ' + (sm.inv ? Math.round((10 - symVal(x.d, sm.k)) * 10) / 10 : symVal(x.d, sm.k)));
    const tip = [longDate(x.key), x.load !== null ? 'day score ' + x.load.toFixed(1) + (x.usual !== null ? ' (usual ' + x.usual.toFixed(1) + ')' : '') : 'no scores', avg7[i] !== null ? '7-day average ' + avg7[i].toFixed(1) : '', x.flare ? 'flare' : x.badDay ? 'bad day' : '', vals.join(', '), stressOf(x) !== null ? 'stress ' + stressOf(x) + '/5' : '', actScore(x) !== null ? 'activity ' + actScore(x).toFixed(1) + '/10' : '', stepsOf(x) !== null ? stepsOf(x).toLocaleString('en-GB') + ' steps' : '', x.d.am ? x.d.am + ' active min (' + effortCls(x).trim().replace('mod', 'moderate') + ')' : ''].filter(Boolean).join(' · ');
    svg += '<rect x="' + Math.max(L, X(i) - colW / 2).toFixed(1) + '" y="' + TOP + '" width="' + colW.toFixed(1) + '" height="' + (H - TOP - 10) + '" class="tr-hit" data-tip="' + esc(tip) + '"/>';
  });
  return svg + '</svg>';
}

/* ---------- Patterns pop-up: each section's comparisons as side-by-side numbers ---------- */
const mean1 = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
const infoI = (text) => ' <button type="button" class="info-i" data-tip="' + esc(text) + '" aria-label="About this section">i</button>';
const patBtn = (key, label) => '<button type="button" class="pt-btn" data-tr="pat" data-v="' + key + '" aria-haspopup="dialog">' + esc(label) + '<span aria-hidden="true">›</span></button>';
/* Verdict for "after A vs after B" on the day score (higher = heavier day). */
function nextDayVerdict(a, b, bName) {
  if (a === null || b === null) return { text: '', tone: '' };
  const d = b - a;
  if (Math.abs(d) < 0.4) return { text: 'No clear difference yet', tone: 'same' };
  return d > 0 ? { text: 'Heavier days after ' + bName, tone: 'worse' } : { text: 'Lighter days after ' + bName, tone: 'better' };
}
/* Activity: busiest vs quiet days, fatigue 1 and 2 days later. */
/* v53: Activity section: weekly summary, daily active minutes by effort, minutes by type, steps (Oura, once served),
   and the Activity patterns popup. */
const OURA_FROM = '2026-11-04';  // Oura ring worn from here: activity and sleep records are more complete after this.
/* v56: one night in detail: Oura's sleep stages strip and figures beside your own rating. */
const minText = (m) => { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) : m + ' min'; };
function nightDetail(x) {
  const d = x.d, o = d.os || {};
  let h = '<div class="night-det"><div class="nd-h"><b>Night to ' + esc(longDate(x.key)) + '</b><button type="button" class="link-btn" data-tr="night" data-v="' + x.key + '">Close</button></div>';
  // v65 (job 17): woke = when you really woke; Oura's later "last asleep" shows as "in bed til".
  const times = [d.ib ? 'into bed ' + d.ib : '', d.bt ? 'asleep ' + d.bt : '', d.wk ? 'woke ' + d.wk : '', o.last && o.last !== d.wk ? 'in bed til ' + o.last : '', d.up ? 'up ' + d.up + (o.upGuess ? ' (Oura’s guess)' : '') : ''].filter(Boolean).join(' · ');
  if (times) h += '<p class="small">' + esc(times) + '</p>';
  if (o.hy) {
    // Hypnogram: one letter per 5 minutes (D deep, L light, R REM, A awake), "|" between sleep periods.
    const seq = o.hy.replace(/\|/g, 'A'), W = 340, H = 46, cw = W / seq.length;
    const row = { A: 0, R: 1, L: 2, D: 3 }, col = { A: '#e0b04a', R: '#a07be0', L: '#7fa3e0', D: '#2b3a8f' };
    let svg = '<svg class="tr-chart hypno" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sleep stages through the night">';
    [...seq].forEach((c, i) => { if (row[c] === undefined) return; svg += '<rect x="' + (i * cw).toFixed(2) + '" y="' + (row[c] * 10 + 2) + '" width="' + (cw + 0.3).toFixed(2) + '" height="9" fill="' + col[c] + '"/>'; });
    h += svg + '</svg><div class="tr-key"><span><i class="sl-k" style="background:#e0b04a"></i>Awake</span><span><i class="sl-k" style="background:#a07be0"></i>REM</span><span><i class="sl-k" style="background:#7fa3e0"></i>Light</span><span><i class="sl-k" style="background:#2b3a8f"></i>Deep</span></div>';
  }
  const cell = (l, v) => (v === undefined || v === null || v === '' ? '' : '<div class="pt-cell"><span>' + esc(l) + '</span><b>' + esc(String(v)) + '</b></div>');
  const cells = [cell('Asleep', giNum(d.sl) ? d.sl + ' h' : ''), cell('Oura sleep score', o.ss), cell('Your rating', giNum(d.q) ? d.q + '/10' : ''), cell('Disturbed (yours)', giNum(d.z) ? d.z + '/5' : ''),
    cell('HRV', o.hrv !== undefined ? o.hrv + ' ms' : ''), cell('Lowest heart rate', o.hr !== undefined ? o.hr + ' bpm' : ''), cell('Readiness', o.rd),
    cell('Deep / REM / light', o.dp !== undefined ? o.dp + ' / ' + (o.rem || 0) + ' / ' + (o.lt || 0) + ' h' : ''), cell('Awake in the night', o.awk !== undefined ? o.awk + ' min' : ''),
    cell('In bed before sleep', o.inb !== undefined ? o.inb + ' min' : ''), cell('Time to get up', o.tgu !== undefined ? minText(o.tgu) : o.lie !== undefined ? o.lie + ' min' : ''), cell('Light sleep after waking', o.doz ? o.doz + ' min' : ''), cell('Nap that day', giNum(d.np) && d.np > 0 ? d.np + ' h' : '')].join('');
  if (cells) h += '<div class="pt-stats nd-grid">' + cells + '</div>';
  if (!d.os && x.key < OURA_FROM) h += '<p class="small">Before the Oura ring: from your own check-ins.</p>';
  return h + '</div>';
}
/* v66: one activity number out of 10 per day. Load = activity minutes weighted by effort (light ×1, moderate ×2,
   hard ×3; logged activity before the ring, Oura sessions' heart-rate bands after) + everyday steps beyond ~3,000
   not already in a walk (at ~110 steps a minute, counted as light). Score = 2.1 × ln(1 + load / 7), capped at 10:
   a curve, so a 40-minute walk ≈ 4 and a big swing night (5 Nov) ≈ 9 (Ru, 7 Nov). No steps and no activity = no data. */
const ACT_SCORE_A = 2.1, ACT_SCORE_B = 7, ACT_BASE_STEPS = 3000, ACT_STEPS_PER_MIN = 110;
function actLoad(x) {
  const d = x.d, st = d.oura && giNum(d.oura.st) ? d.oura.st : null;
  if (!d.al && st === null) return null;
  const walk = d.ak && d.ak.walk ? d.ak.walk : 0;
  const stepMin = st === null ? 0 : Math.max(0, (st - ACT_BASE_STEPS) / ACT_STEPS_PER_MIN - walk);
  return (d.al || 0) + stepMin;
}
function actScore(x) { const l = actLoad(x); return l === null ? null : Math.min(10, ACT_SCORE_A * Math.log(1 + l / ACT_SCORE_B)); }
const ACT_KINDS = [['walk', 'Walking'], ['dance', 'Dance'], ['aerial', 'Aerial'], ['cycle', 'Cycling'], ['carry', 'Carrying / lifting'], ['other', 'Other']];
function activityView(T2) {
  const list = T2.list;
  const info = infoI('Active minutes are your activities: before the ring (4 Nov) the ones you logged, with the effort you gave (or the usual for that kind of activity); from 4 Nov Oura’s sessions, which already include what you log in the app. Effort for ring sessions comes from your heart rate minute by minute, so one dance can be part light, part moderate, part hard. Pottering outside sessions isn’t counted. The top figures compare the last 7 days with the average week in the 4 weeks before.');
  let html = '<h2 class="tr-h tr-h-first">Activity' + info + '</h2>';
  if (!list.some((x) => x.d.am || (x.d.oura && x.d.oura.st))) return html + '<p class="small tr-hint">No activity logged yet.</p>';
  const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
  const last7 = list.slice(-7), prev28 = list.slice(-35, -7);
  const mins7 = sum(last7, (x) => x.d.am), usual = prev28.length ? sum(prev28, (x) => x.d.am) / 4 : null;
  const days7 = last7.filter((x) => x.d.am).length, hard7 = sum(last7, (x) => (x.d.ai ? x.d.ai[2] : 0));
  const diff = usual === null ? '' : Math.abs(mins7 - usual) < 15 ? 'about usual' : Math.round(Math.abs(mins7 - usual)) + ' min ' + (mins7 > usual ? 'more' : 'less') + ' than usual';
  const tile = (l, v, sub) => '<div class="tr-stat"><span>' + esc(l) + '</span><b>' + esc(v) + '</b><small>' + esc(sub) + '</small></div>';
  // v59: steps average from every source (phone before 4 Nov, ring after), over the last 7 finished days
  // (today's count is still growing), compared with the 4 weeks before.
  const stOf = (x) => (x.d.oura && giNum(x.d.oura.st) ? x.d.oura.st : null);
  const done = list.length && list[list.length - 1].key === T2.today ? list.slice(0, -1) : list;
  const st7 = done.slice(-7).map(stOf).filter((v) => v !== null), stPrev = done.slice(-35, -7).map(stOf).filter((v) => v !== null);
  const stSub = st7.length < 3 ? '' : stPrev.length >= 7 ? 'usual ' + (Math.round(mean1(stPrev) / 100) * 100).toLocaleString('en-GB') : 'last 7 full days';
  html += '<div class="tr-sub">Last 7 days</div><div class="tr-stats">' + tile('Active minutes', String(mins7), diff || 'this week') + tile('Active days', days7 + ' of 7', '') +
    (st7.length >= 3 ? tile('Steps a day', (Math.round(mean1(st7) / 100) * 100).toLocaleString('en-GB'), stSub) : tile('Hard effort', hard7 + ' min', 'of the ' + mins7)) + '</div>';
  // Daily bars, stacked by effort.
  const show = list.slice(-42), n = show.length, W = 360, L = 26, R = 6, H = 150, TOP = 8, B = 18, ch = H - TOP - B, bw = (W - L - R) / n;
  const max = Math.max(30, Math.max.apply(null, show.map((x) => (x.d.ai ? (x.d.ol ? 0 : x.d.ai[0]) + x.d.ai[1] + x.d.ai[2] : x.d.am || 0))));
  const nice = max <= 60 ? 60 : max <= 120 ? 120 : max <= 180 ? 180 : Math.ceil(max / 60) * 60;
  const Y = (v) => TOP + ch - (v / nice) * ch;
  let svg = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Active minutes per day, last six weeks">';
  [0, nice / 2, nice].forEach((v) => { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="tr-grid"/><text x="' + (L - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" class="tr-ax" text-anchor="end">' + v + '</text>'; });
  show.forEach((x, i) => {
    const x0 = L + i * bw + bw * 0.15, w = Math.max(1.5, bw * 0.7);
    const parts = x.d.ai ? (x.d.ol ? [0, x.d.ai[1], x.d.ai[2]] : x.d.ai) : x.d.am ? (() => { const r = (x.d.al || 0) / x.d.am; return r >= 2.5 ? [0, 0, x.d.am] : r >= 1.5 ? [0, x.d.am, 0] : [x.d.am, 0, 0]; })() : [0, 0, 0];
    let base = 0;
    ['light', 'mod', 'hard'].forEach((c, k) => { const v = parts[k] || 0; if (!v) return; svg += '<rect x="' + x0.toFixed(1) + '" y="' + Y(base + v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (Y(base) - Y(base + v)).toFixed(1) + '" class="tr-actbar ' + c + '"/>'; base += v; });
    if (keyToDate(x.key).getDay() === 1 && i < n - 2) svg += '<text x="' + (L + i * bw).toFixed(1) + '" y="' + (H - 4) + '" class="tr-ax">' + esc(shortDate(x.key)) + '</text>';
    if (x.key === OURA_FROM) svg += '<line x1="' + (L + i * bw).toFixed(1) + '" x2="' + (L + i * bw).toFixed(1) + '" y1="' + TOP + '" y2="' + (TOP + ch) + '" class="tr-mark"/><text x="' + (L + i * bw - 3).toFixed(1) + '" y="' + (TOP + 8) + '" class="tr-ax" text-anchor="end">Oura tracking</text>';
    const kinds = x.d.ak ? ACT_KINDS.filter(([k]) => x.d.ak[k]).map(([k, l]) => l.toLowerCase() + ' ' + x.d.ak[k] + ' min') : [];
    const tip = [longDate(x.key), x.d.ol ? (x.d.am || 0) + ' active min (Oura)' : x.d.am ? x.d.am + ' active min' : 'no activity logged', kinds.join(', '), x.d.ai ? ['light', 'moderate', 'hard'].map((l, k) => (x.d.ai[k] && !(x.d.ol && !k) ? x.d.ai[k] + ' ' + l : '')).filter(Boolean).join(' · ') : '', x.d.oura && giNum(x.d.oura.st) ? x.d.oura.st.toLocaleString('en-GB') + ' steps' : ''].filter(Boolean).join(' · ');
    svg += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (H - B) + '" class="tr-hit" data-tip="' + esc(tip) + '"/>';
  });
  html += '<div class="tr-sub">Active minutes a day</div>' + svg + '</svg><div class="tr-key act-key"><span><i class="ak light"></i>Light</span><span><i class="ak mod"></i>Moderate</span><span><i class="ak hard"></i>Hard</span></div>';
  // Minutes by type over the last 4 weeks.
  // v57: steps a day (Apple Health before the ring, Oura from 4 Nov).
  const stepDays = show.map((x) => (x.d.oura && giNum(x.d.oura.st) ? x.d.oura.st : null));
  if (stepDays.some((v) => v !== null)) {
    const smax = Math.max(10000, Math.max.apply(null, stepDays.filter((v) => v !== null)));
    const snice = Math.ceil(smax / 5000) * 5000, SY = (v) => TOP + ch - (v / snice) * ch;
    let sv = '<svg class="tr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Steps per day, last six weeks">';
    [0, snice / 2, snice].forEach((v) => { sv += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + SY(v).toFixed(1) + '" y2="' + SY(v).toFixed(1) + '" class="tr-grid"/><text x="' + (L - 4) + '" y="' + (SY(v) + 3).toFixed(1) + '" class="tr-ax" text-anchor="end">' + (v ? v / 1000 + 'k' : 0) + '</text>'; });
    show.forEach((x, i) => {
      const v = stepDays[i], x0 = L + i * bw + bw * 0.15, w = Math.max(1.5, bw * 0.7);
      if (v !== null) sv += '<rect x="' + x0.toFixed(1) + '" y="' + SY(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (SY(0) - SY(v)).toFixed(1) + '" class="st-bar' + (x.d.oura.src === 'apple' ? ' apple' : '') + '"/>';
      if (keyToDate(x.key).getDay() === 1 && i < n - 2) sv += '<text x="' + (L + i * bw).toFixed(1) + '" y="' + (H - 4) + '" class="tr-ax">' + esc(shortDate(x.key)) + '</text>';
      if (x.key === OURA_FROM) sv += '<line x1="' + (L + i * bw).toFixed(1) + '" x2="' + (L + i * bw).toFixed(1) + '" y1="' + TOP + '" y2="' + (TOP + ch) + '" class="tr-mark"/>';
      sv += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (H - B) + '" class="tr-hit" data-tip="' + esc(longDate(x.key) + ' · ' + (v === null ? 'no step count' : v.toLocaleString('en-GB') + ' steps (' + (x.d.oura.src === 'apple' ? 'Apple Health' : 'Oura') + ')')) + '"/>';
    });
    html += '<div class="tr-sub">Steps a day</div>' + sv + '</svg><div class="tr-key"><span><i class="ak" style="background:#a9b7cc"></i>Apple Health (phone)</span><span><i class="ak" style="background:#4a7fd6"></i>Oura ring, from 4 Nov</span></div>';
  }
  // v54: average week over the last 4 weeks, by type.
  // v62: each type's bar is split light / moderate / hard (d.aki, HealthLog v62), so walking and dancing compare.
  const last28 = list.slice(-28), fmtM = (v) => (v >= 120 ? (v / 60).toFixed(1).replace('.0', '') + ' h' : v + ' min');
  const byKind = ACT_KINDS.map(([k, l]) => {
    const tot = sum(last28, (x) => (x.d.ak ? x.d.ak[k] : 0));
    const sp = [0, 1, 2].map((i) => sum(last28, (x) => (x.d.aki && x.d.aki[k] ? x.d.aki[k][i] : 0)));
    const known = sp[0] + sp[1] + sp[2];
    return [l, Math.round(tot / 4), known ? sp.map((v) => (v / known) * (tot / 4)) : null];
  }).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (byKind.length) {
    const top = byKind[0][1];
    html += '<div class="tr-sub">Average week, by type and effort (last 4 weeks)</div><div class="act-types">' + byKind.map(([l, v, sp]) => {
      const w = Math.max(4, Math.round((v / top) * 100));
      const bar = sp ? '<i class="at-split" style="width:' + w + '%">' + ['light', 'mod', 'hard'].map((c, i) => (sp[i] > 0 ? '<em class="' + c + '" style="width:' + ((sp[i] / v) * 100).toFixed(1) + '%"></em>' : '')).join('') + '</i>' : '<i style="width:' + w + '%"></i>';
      const tip = l + ': ' + fmtM(v) + ' a week' + (sp ? ' · ' + ['light', 'moderate', 'hard'].map((n, i) => (Math.round(sp[i]) ? Math.round(sp[i]) + ' min ' + n : '')).filter(Boolean).join(', ') : '');
      return '<div class="at-row" data-tip="' + esc(tip) + '"><span>' + esc(l) + '</span>' + bar + '<b>' + fmtM(v) + '</b></div>';
    }).join('') + '</div><div class="tr-key act-key"><span><i class="ak light"></i>Light</span><span><i class="ak mod"></i>Moderate</span><span><i class="ak hard"></i>Hard</span></div>';
  }
  return html + patBtn('activity', 'Activity and symptoms');
}
/* v51/v52: how activity relates to every symptom. Days are split at the median active minutes (
   or Oura steps once the ring is synced), then each symptom is compared on the same day, the next day or two days
   later. The table is sorted by the size of the difference, so the symptoms that move most come first. */
/* v63 (job 15): what happens around active days, by kind of activity. Dance / aerial (and, with the ring, other
   sessions with 30+ moderate + hard minutes) are kept apart from long walks and busy step days. For each occasion,
   the day before, the day itself and the next two days are compared with your usual (middle value of the 14 days
   before), using up-and-about readings averaged by part of the day (HealthLog v63). Every difference is shown; a
   pattern is only named from about 10 occasions mostly going the same way. */
function activityAround(T2) {
  const list = T2.list, keys = TREND_SYMS.map((x) => x.k);
  const upVal = (x, k) => { if (!x || !x.d.pt) return null; const v = PART_UP.map((pt) => x.d.pt[pt] && x.d.pt[pt][k]).filter((y) => typeof y === 'number'); return v.length ? v.reduce((t, a) => t + a, 0) / v.length : null; };
  const nonWalkHard = (x) => (x.d.aki ? Object.keys(x.d.aki).filter((k) => k !== 'walk').reduce((t, k) => t + x.d.aki[k][1] + x.d.aki[k][2], 0) : 0);
  const danceMin = (x) => (x.d.ak ? (x.d.ak.dance || 0) + (x.d.ak.aerial || 0) : 0);
  const isDance = (x) => danceMin(x) >= 30 || (x.key >= OURA_FROM && nonWalkHard(x) >= 30);
  const isWalk = (x) => !isDance(x) && ((x.d.ak && x.d.ak.walk >= 45) || (x.d.oura && giNum(x.d.oura.st) && x.d.oura.st >= 10000));
  const group = TR.actGroup === 'walk' ? 'walk' : 'dance';
  const test = group === 'walk' ? isWalk : isDance;
  const occ = [];
  list.forEach((x, i) => { if (i >= 2 && i < list.length - 1 && test(x)) occ.push(i); });
  const OFF = [[-1, 'Day before'], [0, 'On the day'], [1, 'Next day'], [2, '2 days later']];
  const rows = keys.map((k) => {
    const sm = TREND_SYMS.find((y) => y.k === k);
    const cells = OFF.map(([o]) => {
      const diffs = [];
      occ.forEach((i) => {
        const t = list[i + o];
        if (!t) return;
        const v = upVal(t, k);
        if (v === null) return;
        const base = list.slice(Math.max(0, i - 15), Math.max(0, i - 1)).map((y) => upVal(y, k)).filter((y) => y !== null);
        if (base.length < 5) return;
        diffs.push(v - median(base));
      });
      if (!diffs.length) return null;
      const m = mean1(diffs), worse = diffs.filter((d) => d > 0).length, better = diffs.filter((d) => d < 0).length;
      const same = m >= 0 ? worse : better;
      return { m, n: diffs.length, same, pattern: diffs.length >= 10 && same / diffs.length >= 0.7 && Math.abs(m) >= 0.3 };
    });
    return { name: sm.name, cells };
  });
  const p = { title: 'Activity and symptoms', stats: [], comps: [] };
  let h = '<div class="tr-chips tr-lag">' + [['dance', 'Dance and hard sessions'], ['walk', 'Long walks and busy step days']].map(([k, l]) => '<button type="button" class="tr-chip" data-tr="actgroup" data-v="' + k + '" aria-pressed="' + (group === k) + '">' + l + '</button>').join('') + '</div>';
  p.stats.push({ label: group === 'walk' ? 'Walking days' : 'Dance / hard days', value: String(occ.length), sub: occ.length >= 10 ? 'enough to see patterns' : 'patterns need about 10' });
  if (!occ.length) { p.empty = 'No ' + (group === 'walk' ? 'long-walk or 10,000-step days' : 'dance or hard-session days') + ' with check-ins around them yet.'; p.html = h; return p; }
  const pats = [];
  rows.forEach((r) => r.cells.forEach((c, j) => { if (c && c.pattern) pats.push(r.name.toLowerCase() + ' ' + (c.m > 0 ? 'worse' : 'better') + ' ' + OFF[j][1].toLowerCase()); }));
  h += '<p class="pt-lead">' + (pats.length ? 'Pattern: <b>' + esc(pats.join('; ')) + '</b>.' : occ.length < 10 ? 'Too few occasions to call anything a pattern yet; the numbers show the direction so far.' : 'No clear pattern: nothing goes the same way on 7 in 10 occasions.') + '</p>';
  h += '<table class="pt-table pt-around"><thead><tr><th></th>' + OFF.map(([, l]) => '<th>' + l + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) =>
    '<tr><td>' + esc(r.name.replace('Mental clarity', 'Clarity')) + '</td>' + r.cells.map((c) => {
      if (!c) return '<td class="same">–</td>';
      const tone = Math.abs(c.m) < 0.3 ? 'same' : c.m > 0 ? 'worse' : 'better';
      return '<td class="' + tone + (c.pattern ? ' top' : '') + '">' + (tone === 'same' ? '≈' : (c.m > 0 ? '▼ ' : '▲ ') + Math.abs(c.m).toFixed(1)) + '<small>' + c.same + ' of ' + c.n + '</small></td>';
    }).join('') + '</tr>').join('') + '</tbody></table>';
  p.html = h;
  p.note = '▲ = better than your usual, ▼ = worse (pain, stiffness, fatigue or headache higher; clarity or mood lower), ≈ = within 0.3. "5 of 6" = how many occasions went that way. Usual = the middle value of the 14 days before each occasion. Uses up-and-about readings only, each part of the day counted once. Late nights, missed medication and other things change too, so this shows patterns, not causes.';
  return p;
}
function activityPatterns(T2) {
  if (T2.parts) return activityAround(T2);
  const list = T2.list;
  const steps = (x) => (x && x.d.oura && giNum(x.d.oura.st) ? x.d.oura.st : null);
  const useSteps = list.filter((x) => steps(x) !== null).length >= 14;
  const act = (x) => (useSteps ? steps(x) : x.d.am || 0);
  const firstLog = list.findIndex((x) => (useSteps ? steps(x) !== null : x.d.al));
  if (firstLog < 0) return null;
  const days = list.slice(firstLog);
  const lag = [0, 1, 2].includes(TR.actLag) ? TR.actLag : 1;
  const SYMS = TREND_SYMS.map((sm) => ({ name: sm.name, get: (x) => symVal(x.d, sm.k), inv: sm.inv }))
    .concat([{ name: 'Stomach pain', get: (x) => (giNum(symVal(x.d, 'st')) ? symVal(x.d, 'st') : null) }, { name: 'Bloating', get: (x) => (giNum(symVal(x.d, 'b')) ? symVal(x.d, 'b') : null) },
      { name: 'Sleep quality (that night)', get: (x) => (giNum(x.d.q) ? 10 - x.d.q : null), inv: true, nightOf: true }, { name: 'Stress', get: (x) => (giNum(symVal(x.d, 'x')) ? symVal(x.d, 'x') * 2 : null), scale: 0.5 }]);
  const vals = days.map(act).filter((v) => v !== null).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  const busy = (x) => act(x) !== null && act(x) > median, quiet = (x) => act(x) !== null && act(x) <= median;
  const idx = {}; list.forEach((x, i) => { idx[x.key] = i; });
  const rows = SYMS.map((sm) => {
    // "That night" sleep is stored on the next morning's day.
    const target = (x) => list[idx[x.key] + lag + (sm.nightOf ? 1 : 0)];
    const pick = (f) => days.filter(f).map((x) => { const t = target(x); return t ? sm.get(t) : null; }).filter((v) => typeof v === 'number');
    const b = pick(busy), q = pick(quiet);
    if (b.length < 4 || q.length < 4) return null;
    const mb = mean1(b), mq = mean1(q), sc = sm.scale || 1;
    const shown = (v) => ((sm.inv ? 10 - v : v) * sc).toFixed(1);
    return { name: sm.name, q: shown(mq), b: shown(mb), d: (mb - mq) * sc, n: Math.min(b.length, q.length) };
  }).filter(Boolean).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const lagWord = ['the same day', 'the next day', 'two days later'][lag];
  const week = list.slice(-7).reduce((t, x) => t + (x.d.am || 0), 0);
  const p = { title: 'Activity patterns', stats: [{ label: 'Active, last 7 days', value: week + ' min' }], comps: [] };
  const st7 = list.slice(-7).map(steps).filter((v) => v !== null);
  if (st7.length) p.stats.push({ label: 'Steps, 7-day average', value: Math.round(mean1(st7)).toLocaleString('en-GB') });
  let h = '<div class="tr-chips tr-lag">' + [[0, 'Same day'], [1, 'Next day'], [2, '2 days later']].map(([k, l]) => '<button type="button" class="tr-chip" data-tr="actlag" data-v="' + k + '" aria-pressed="' + (lag === k) + '">' + l + '</button>').join('') + '</div>';
  if (!rows.length) { p.empty = 'A few more days of activity and check-ins and this will compare more and less active days for each symptom.'; p.html = h; return p; }
  const top = rows.filter((r) => Math.abs(r.d) >= 0.5).slice(0, 2);
  const word = (r) => (r.d > 0 ? 'worse' : 'better');
  h += '<p class="pt-lead">' + (top.length ? 'Biggest difference ' + lagWord + ': <b>' + top.map((r) => esc(r.name.toLowerCase()) + ' ' + Math.abs(r.d).toFixed(1) + ' ' + word(r)).join('</b> and <b>') + '</b> after more active days.' : 'No symptom differs by half a point or more ' + lagWord + ' between more and less active days so far.') + '</p>';
  h += '<table class="pt-table"><thead><tr><th>' + esc(lagWord.charAt(0).toUpperCase() + lagWord.slice(1)) + '</th><th>Less active days</th><th>More active days</th><th></th></tr></thead><tbody>' + rows.map((r) => {
    const tone = Math.abs(r.d) < 0.5 ? 'same' : r.d > 0 ? 'worse' : 'better';
    return '<tr class="' + tone + (top.includes(r) ? ' top' : '') + '"><td>' + esc(r.name) + '</td><td>' + r.q + '</td><td>' + r.b + '</td><td>' + (tone === 'same' ? '≈' : (r.d > 0 ? '▼ ' : '▲ ') + Math.abs(r.d).toFixed(1) + (tone === 'worse' ? ' worse' : ' better')) + '</td></tr>';
  }).join('') + '</tbody></table>';
  p.html = h;
  p.note = 'More active = days above your middle (median) ' + (useSteps ? 'step count (Oura)' : 'number of active minutes logged') + '; less active = the rest. Differences under half a point count as the same. Stress is shown out of 5. Other things change too (sleep, stress, food), so this shows patterns, not causes.';
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
const giMode = () => (['pain', 'bloat', 'both'].includes(TR.gi) ? TR.gi : 'both');
/* Value for part r (0 morning … 3 night): stomach pain, bloating (HealthLog v14), or the worse of the two. */
function giPart(d, r) {
  const p = d[r + 1], b = d.length > 8 ? d[r + 8] : null, m = giMode();
  if (m === 'pain') return giNum(p) ? p : null;
  if (m === 'bloat') return giNum(b) ? b : null;
  return giNum(p) || giNum(b) ? Math.max(giNum(p) ? p : 0, giNum(b) ? b : 0) : null;
}
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
      let v = giPart(d, r), cls = '', label = '';
      if (giNum(v)) { cls = 's' + stomachLevel(v); label = GI_PARTS[r].toLowerCase() + ' ' + v; }
      else if (r === 0 && d[5] === 0) { cls = 's0'; label = 'no stomach pain on waking'; }
      if (!cls) continue;
      svg += '<rect x="' + (L + i * bw + 0.5).toFixed(1) + '" y="' + (top + r * (rowH + gap)) + '" width="' + Math.max(1.5, bw - 1).toFixed(1) + '" height="' + rowH + '" rx="1.5" class="tr-part ' + cls + '"/>';
    }
  }
  // Invisible columns on top: hover or tap shows that day's readings.
  for (let i = 0; i < n; i++) {
    const k = addDays(first, i), d = G.by[k];
    if (!d) continue;
    const bits = GI_PARTS.map((name, r) => {
      const p = d[r + 1], b = d.length > 8 ? d[r + 8] : null;
      const parts = [giNum(p) ? 'pain ' + p : '', giNum(b) ? 'bloating ' + b : ''].filter(Boolean);
      return parts.length ? name.toLowerCase() + ' ' + parts.join(', ') : '';
    }).filter(Boolean);
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
  return '<div class="tr-sub tr-sub-c">Through the day</div><div class="tr-chips tr-gichips">' + [['pain', 'Pain'], ['bloat', 'Bloating'], ['both', 'Both']].map(([k, l]) =>
    '<button type="button" class="tr-chip" data-tr="gi" data-v="' + k + '" aria-pressed="' + (giMode() === k) + '">' + l + '</button>').join('') + '</div>' + svg +
    '<div class="tr-key"><span><i class="tr-omeline-key"></i>Omeprazole started</span></div>' +
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
  if (!k) return html + parts;
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
/* v35 sleep: summary of the last 7 nights against the 28 before, then one "sleep window" chart:
   each night a bar from went-to-sleep down to woke (pale extension = in bed until getting up), shaded by quality. */
const clockMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); if (!m) return null; const v = Number(m[1]) * 60 + Number(m[2]); return v < 21 * 60 ? v + 1440 : v; };
function nightOf(d) {
  const bed = bedMinutes(d.bt);
  let woke = clockMin(d.wk);
  if (bed !== null && woke === null && giNum(d.sl)) woke = bed + d.sl * 60;
  if (bed !== null && woke !== null && woke <= bed) woke = null;
  let up = clockMin(d.up);
  if (up !== null && (woke === null || up < woke)) up = null;
  const hours = bed !== null && woke !== null ? (woke - bed) / 60 : giNum(d.sl) ? d.sl : null;
  let inBed = bedMinutes(d.ib);
  if (inBed !== null && bed !== null && (inBed >= bed || bed - inBed > 6 * 60)) inBed = null;
  // v57: time in bed (into bed → out of bed) and time to fall asleep (into bed → asleep), only when both ends were recorded.
  const tib = inBed !== null && up !== null && up > inBed ? (up - inBed) / 60 : null;
  const lat = inBed !== null && bed !== null && bed >= inBed ? bed - inBed : null;
  // v65: time to get up = woke → out of bed (how hard it is to get up, awake or sleeping lightly).
  const tgu = woke !== null && up !== null && up >= woke && up - woke < 8 * 60 ? up - woke : null;
  return { bed, woke, up, inBed, hours, tib, lat, tgu, q: giNum(d.q) ? d.q : null, z: giNum(d.z) ? d.z : null };
}
function sleepView(T2) {
  const list = T2.list.slice(-42), n = list.length;
  if (!n) return '';
  const nights = list.map((x) => nightOf(x.d));
  const all = T2.list.map((x) => nightOf(x.d));
  const avg = (arr, k) => { const v = arr.map((x) => x[k]).filter((y) => typeof y === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const recentN = all.slice(-7), usualN = all.slice(-35, -7);
  const stat = (label, k, fmt, diffFmt) => {
    const a = avg(recentN, k), u = avg(usualN, k);
    let sub = 'last 7 nights';
    if (a !== null && u !== null) sub = diffFmt(a - u);
    return '<div class="tr-stat"><span>' + label + '</span><b>' + (a === null ? '–' : esc(fmt(a))) + '</b><small>' + esc(sub) + '</small></div>';
  };
  const minsWord = (dm) => { const m = Math.round(Math.abs(dm)); return m < 15 ? 'about usual' : (m >= 60 ? (m / 60).toFixed(1).replace('.0', '') + ' h' : m + ' min') + (dm > 0 ? ' later than usual' : ' earlier than usual'); };
  const numWord = (unit, more, less) => (dv) => (Math.abs(dv) < 0.25 ? 'about usual' : Math.abs(dv).toFixed(1) + unit + ' ' + (dv > 0 ? more : less) + ' than usual');
  let html = '<h2 class="tr-h">Sleep' + infoI('Each bar is one night, from falling asleep (bottom) up to waking (top); the dashed part above is the time to get up (from really waking, awake or still sleeping lightly, to out of bed). Since the ring, woke = the first proper waking after your last deep sleep, not Oura’s last scrap of light sleep. Colour = sleep quality; grey = not rated. White lines = how disturbed (one per point out of 5). Dashed lines = your usual sleep and waking times (the 4 weeks before the last 7 nights). Time in bed (into bed → out of bed) and time to fall asleep (into bed → asleep) only count nights where both times were recorded. Naps aren’t included in hours asleep.') + '</h2><div class="tr-sub">Last 7 nights · averages, compared with the 4 weeks before</div><div class="tr-stats">' +
    stat('Fell asleep at', 'bed', clockText, minsWord) +
    stat('Hours asleep', 'hours', (v) => v.toFixed(1), (dv) => numWord(' h', 'more', 'less')(dv) + (T2.list.slice(-7).some((x) => x.d.np) ? ' · nights only, a nap not counted' : '')) +
    stat('Time in bed', 'tib', (v) => v.toFixed(1) + ' h', numWord(' h', 'more', 'less')) +
    stat('Time to fall asleep', 'lat', (v) => Math.round(v) + ' min', (dv) => (Math.abs(dv) < 5 ? 'about usual' : Math.round(Math.abs(dv)) + ' min ' + (dv > 0 ? 'longer' : 'shorter') + ' than usual')) +
    stat('Time to get up', 'tgu', (v) => minText(v), (dv) => (Math.abs(dv) < 10 ? 'about usual' : minText(Math.abs(dv)) + ' ' + (dv > 0 ? 'longer' : 'shorter') + ' than usual')) +
    stat('Quality', 'q', (v) => v.toFixed(1) + '/10', numWord('', 'higher', 'lower')) + '</div>';
  // Chart: time runs up from 22:00 (bottom) to 15:00 next day (top).
  const W = 360, L = 34, R = 4, top = 4, H = 250, base = H - 16, lo = 22 * 60, hi = 39 * 60, bw = (W - L - R) / n;
  const y = (m) => base - ((Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * (base - top);
  let svg = '<svg class="tr-chart sleep-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sleep window per night, last six weeks">';
  [[24 * 60, '00:00'], [27 * 60, '03:00'], [30 * 60, '06:00'], [33 * 60, '09:00'], [36 * 60, '12:00'], [39 * 60, '15:00']].forEach(([m, t]) => {
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(m).toFixed(1) + '" y2="' + y(m).toFixed(1) + '" class="tr-grid"/><text x="' + (L - 4) + '" y="' + (y(m) + 3).toFixed(1) + '" class="tr-ax" text-anchor="end">' + t + '</text>';
  });
  const uBed = avg(usualN.length >= 5 ? usualN : all, 'bed'), uWoke = avg(usualN.length >= 5 ? usualN : all, 'woke');
  if (uBed !== null) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(uBed).toFixed(1) + '" y2="' + y(uBed).toFixed(1) + '" class="sl-usual"/>';
  if (uWoke !== null) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(uWoke).toFixed(1) + '" y2="' + y(uWoke).toFixed(1) + '" class="sl-usual"/>';
  const qCls = (q) => (q === null ? 'sl-qn' : q >= 7 ? 'sl-q3' : q > 5 ? 'sl-q2' : 'sl-q1');
  nights.forEach((nt, i) => {
    const x0 = L + i * bw + 1, w = Math.max(2, bw - 2);
    if (nt.bed === null) return;
    if (nt.woke === null) { svg += '<circle cx="' + (x0 + w / 2).toFixed(1) + '" cy="' + y(nt.bed).toFixed(1) + '" r="2.4" class="sl-dot ' + qCls(nt.q) + '"/>'; return; }
    if (nt.up !== null) svg += '<rect x="' + x0.toFixed(1) + '" y="' + y(nt.up).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(nt.woke) - y(nt.up)).toFixed(1) + '" rx="1.5" class="sl-lie"/>';
    // v52: in bed before falling asleep (from the Bed check-in), dashed below the bar.
    if (nt.inBed !== null) svg += '<rect x="' + x0.toFixed(1) + '" y="' + y(nt.bed).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(nt.inBed) - y(nt.bed)).toFixed(1) + '" rx="1.5" class="sl-lie"/>';
    const yTop = y(nt.woke), yBot = y(nt.bed), hgt = Math.max(2, yBot - yTop);
    svg += '<rect x="' + x0.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="1.5" class="sl-bar ' + qCls(nt.q) + '"/>';
    // Disturbed: one white tick per point (0–5), spread along the bar.
    const z = Math.round(nt.z || 0);
    for (let t = 1; t <= z; t++) { const ty = yTop + (hgt * t) / (z + 1); svg += '<line x1="' + x0.toFixed(1) + '" x2="' + (x0 + w).toFixed(1) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" class="sl-tick"/>'; }
  });
  // v40: a nap that day may make the night look short: ring above the bar (HealthLog v16 reads naps from notes).
  list.forEach((x, i) => { if (x.d.np) svg += '<circle cx="' + (L + i * bw + bw / 2).toFixed(1) + '" cy="' + (top + 4) + '" r="3" class="sl-nap"/>'; });
  // Week labels under each Monday.
  list.forEach((x, i) => { if (keyToDate(x.key).getDay() === 1 && i < n - 3) svg += '<text x="' + (L + i * bw).toFixed(1) + '" y="' + (H - 3) + '" class="tr-ax">' + esc(shortDate(x.key)) + '</text>'; });
  const tipOf = (x, nt) => [longDate(x.key), nt.inBed !== null ? 'into bed ' + x.d.ib : '', x.d.bt ? 'asleep ' + x.d.bt : '', x.d.wk ? 'woke ' + x.d.wk : '', x.d.up ? 'up ' + x.d.up : '',
    nt.hours !== null ? nt.hours.toFixed(1) + ' h' : '', nt.q !== null ? 'quality ' + nt.q + '/10' : '', giNum(x.d.z) ? 'disturbed ' + x.d.z + '/5' : '', x.d.np ? 'nap that day' + (x.d.np > 0 ? ' (~' + x.d.np + ' h)' : '') + ': the night alone may look short' : ''].filter(Boolean);
  // v56: Oura ring from 4 Nov; tap a night for its details.
  list.forEach((x, i) => { if (x.key === OURA_FROM) svg += '<line x1="' + (L + i * bw).toFixed(1) + '" x2="' + (L + i * bw).toFixed(1) + '" y1="' + (top + 12) + '" y2="' + base + '" class="tr-mark"/><text x="' + (L + i * bw - 3).toFixed(1) + '" y="' + (base - 4) + '" class="tr-ax" text-anchor="end">Oura tracking</text>'; });
  list.forEach((x, i) => { const t = tipOf(x, nights[i]); if (t.length > 1) svg += '<rect x="' + (L + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + base + '" class="tr-hit' + (TR.night === x.key ? ' on' : '') + '" data-tr="night" data-v="' + x.key + '" data-tip="' + esc(t.join(' · ')) + '"/>'; });
  svg += '</svg>';
  const sel = TR.night && list.find((x) => x.key === TR.night);
  if (sel) svg += nightDetail(sel);
  html += svg + '<div class="tr-key"><span><i class="sl-k sl-q3"></i>Good (7+)</span><span><i class="sl-k sl-q2"></i>OK</span><span><i class="sl-k sl-q1"></i>Poor (5 or less)</span><span><i class="sl-k sl-qn"></i>Not rated</span>' + (list.some((x) => x.d.np) ? '<span><i class="sl-k sl-napk"></i>Nap that day</span>' : '') + '<span><i class="sl-k sl-lie"></i>In bed before sleep, and time to get up (awake or sleeping lightly)</span><span><i class="sl-k sl-tk"></i>Disturbed (1 line per point of 5)</span><span><i class="sl-k sl-uk"></i>Your usual: fell asleep ' + (uBed !== null ? clockText(uBed) : '–') + ', woke ' + (uWoke !== null ? clockText(uWoke) : '–') + '</span></div>' +
    '' + patBtn('sleep', 'Sleep patterns');
  return html;
}

/* ---------- Medication history: pick a medicine, see every day it was logged (scrollable), and how long you've been on it ---------- */
function medsView(today) {
  const data = medCounts();
  if (!data) return '';
  const names = Object.keys(data);
  if (!names.length) return '';
  const cur = TR.medOpen && data[TR.medOpen] ? TR.medOpen : names[0];
  const d = data[cur];
  const taken = Object.keys(d.byDay).filter((k) => d.byDay[k] > 0 && k <= today).sort();
  const firstKey = taken[0] || today;
  // v34: the Log tab's 14-day rows; tap one to open its full calendar below.
  let html = '<h2 class="tr-h">Medication</h2><div class="tr-medhist">' + historyView('health') + '</div>' + ((cfg.suppPlan || suppList().length) ? patBtn('suppplan', 'Supplements: products and plan') : '');
  if (!TR.medOpen || !data[TR.medOpen]) return html;
  html += '<div class="tr-medsel"><b>' + esc(cur) + '</b></div>';
  html += calGrid('med-' + cur, cur + ' calendar', firstKey, today, (k) => {
    const n = d.byDay[k] || 0, day = keyToDate(k).getDate();
    const cls = ['tr-cell', n ? (d.perDay > 0 && n < d.perDay ? 'mpart' : 'mon') : 'moff'];
    if (k === today) cls.push('today');
    const amount = d.mg && n ? (d.mg[k] ? d.mg[k] + (d.unknown[k] ? '+' : '') : '?') : '';
    return '<span class="' + cls.join(' ') + '" data-tip="' + esc(longDate(k) + ' · ' + (n ? (d.supps ? suppWord(n) + (d.names[k] ? ': ' + d.names[k].join(', ') : '') : n + (n === 1 ? ' dose' : ' doses')) + (amount ? ' · ' + amount + ' mg' : '') : 'none logged')) + '">' + day + (amount ? '<i class="tr-mg">' + amount + '</i>' : '') + '</span>';
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
  if (taken.length >= 3) html += patBtn('medfx:' + cur, 'What ' + (d.supps ? 'supplements seem' : cur + ' seems') + ' to do');
  return html + '<p class="small tr-hint">Dark = logged' + (d.supps ? ', half = some of the ones due' : d.perDay > 1 ? ', half = some of ' + d.perDay + ' doses' : '') + (d.mg ? ', small number = mg' : '') + '. Counts logged doses only; before 4am counts as the night before.</p>';
}
/* v69: "What it seems to do" for each medicine (Meds tab › a medicine › button). Compares days it was taken with days
   it wasn't, inside the time you were using it (from the first dose to 3 days after the last), on every measure
   the app has: the six symptoms (up-and-about readings, each part of the day once), day level, stomach, bloating,
   stress, the night's sleep, activity and bowel. Because other things change too, it also shows what else was
   different on those days (getting up later, shorter sleep, other medicines taken at the same time) and repeats the
   comparison among days with a similar getting-up time, so a late start can't pass for a medicine effect.
   Night medicines (amitriptyline) are judged on the night and the next day; as-needed painkillers are taken
   because of pain, so their days look worse by design. */
const MED_NIGHT = /amitriptyline/i, MED_ASNEEDED_PER_DAY = 0;
/* v70: which medicines' absence before the first dose means "not taken" (Ru, 8 Nov). Never taken before the trials:
   every earlier day is a day without. Logged in the older logs too (codeine → Co-codamol): earlier days count.
   Others (supplements) weren't reliably logged before, so only gaps while in use
   count. 8 Nov (Ru): paracetamol and Elvanse were logged in the older records when taken, so their earlier days
   count; probiotic only before ~10 Sep. Older logs = before 8 Oct (imports from the paper / Bearable / old Daily records); a chip turns them off. */
const MED_NEVER_BEFORE = /^(celecoxib|omeprazole|amitriptyline)$/i, MED_LOGGED_BEFORE = /^(co-codamol|paracetamol|elvanse)$/i, OLD_LOGS_BEFORE = '2026-10-08';
// Known to be not taken before a date (Ru, 8 Nov: probiotic started around 10 Sep); between that date and the first logged dose is unknown.
const MED_FREE_BEFORE = { probiotic: '2026-09-10' };
function upValDay(x, k) {
  if (!x || !x.d.pt) return null;
  const v = PART_UP.map((pt) => x.d.pt[pt] && x.d.pt[pt][k]).filter((y) => typeof y === 'number');
  return v.length ? v.reduce((t, a) => t + a, 0) / v.length : null;
}
function medEffect(T2, name) {
  const data = medCounts(), d = data && data[name];
  if (!d) return { title: name, empty: 'No data yet.' };
  const list = T2.list, by = T2.by, today = T2.today;
  const night = MED_NIGHT.test(name), asNeeded = d.perDay === MED_ASNEEDED_PER_DAY;
  const taken = list.filter((x) => d.byDay[x.key] > 0 && x.key < today).map((x) => x.key);
  const p = { title: name + ': what it seems to do', stats: [], comps: [] };
  if (taken.length < 3) { p.empty = 'Needs at least 3 days with ' + name + ' logged.'; return p; }
  const first = taken[0], last = taken[taken.length - 1];
  const priorOk = MED_NEVER_BEFORE.test(name) || MED_LOGGED_BEFORE.test(name);
  const freeBefore = MED_FREE_BEFORE[name.toLowerCase()] || '';
  const useOld = TR.medOld !== false;
  const hasData = (x) => x.load !== null || (x.d.pt && Object.keys(x.d.pt).length);
  const inUse = list.filter((x) => (priorOk ? true : x.key >= first || (freeBefore && x.key < freeBefore)) && x.key <= addDays(last, 3) && x.key < today && (useOld || x.key >= OLD_LOGS_BEFORE) && hasData(x));
  const on = inUse.filter((x) => d.byDay[x.key] > 0), off = inUse.filter((x) => !(d.byDay[x.key] > 0));
  const offOld = off.filter((x) => x.key < OLD_LOGS_BEFORE).length, offBefore = off.filter((x) => x.key < first).length;
  // The day whose symptoms count: the same day, or the next for a night medicine. Sleep = the night after the dose.
  const tgt = (x) => (night ? by[addDays(x.key, 1)] : x);
  const nightAfter = (x) => by[addDays(x.key, 1)];
  const G = giData();
  const upTime = (x) => { const t = tgt(x); return t ? clockMin(t.d.up) : null; };
  const OUT = [
    ...TREND_SYMS.map((sm) => ({ name: sm.name.replace('Mental clarity', 'Clarity'), get: (x) => upValDay(tgt(x), sm.k), worse: 1, unit: '' })),
    { name: 'Day level (all symptoms)', get: (x) => (tgt(x) ? tgt(x).load : null), worse: 1, unit: '' },
    { name: 'Stomach pain', get: (x) => (tgt(x) && giNum(symVal(tgt(x).d, 'st')) ? symVal(tgt(x).d, 'st') : null), worse: 1, unit: '' },
    { name: 'Bloating', get: (x) => (tgt(x) && giNum(symVal(tgt(x).d, 'b')) ? symVal(tgt(x).d, 'b') : null), worse: 1, unit: '' },
    { name: 'Stress', get: (x) => (tgt(x) && giNum(symVal(tgt(x).d, 'x')) ? symVal(tgt(x).d, 'x') : null), worse: 1, unit: '' },
    { name: 'Sleep quality that night', get: (x) => { const n = nightAfter(x); return n && typeof n.d.q === 'number' ? n.d.q : null; }, worse: -1, unit: '' },
    { name: 'Hours asleep that night', get: (x) => { const n = nightAfter(x); return n && typeof n.d.sl === 'number' ? n.d.sl : null; }, worse: -1, unit: 'h' },
    { name: 'Fell asleep that night', get: (x) => { const n = nightAfter(x); return n ? bedMinutes(n.d.bt) : null; }, worse: 0, unit: 'min' },
    { name: 'Activity (0–10)', get: (x) => (tgt(x) ? actScore(tgt(x)) : null), worse: 0, unit: '' },
    { name: 'Bowel: Bristol type', get: (x) => { const g = G && G.by[x.key]; return g && Array.isArray(g.bx) && g.bx.length ? mean1(g.bx) : null; }, worse: 0, unit: '' },
  ];
  const vals = (arr, f) => arr.map(f).filter((v) => typeof v === 'number' && !isNaN(v));
  // Same-start comparison: getting-up time in 3 bands, differences averaged across bands that have both kinds of day.
  const band = (x) => { const u = upTime(x); return u === null ? null : u < 10.5 * 60 + 1440 ? 0 : u < 12.5 * 60 + 1440 ? 1 : 2; };
  const matched = (f) => {
    let tot = 0, wsum = 0;
    [0, 1, 2].forEach((b) => {
      const A = vals(on.filter((x) => band(x) === b), f), B = vals(off.filter((x) => band(x) === b), f);
      if (A.length >= 2 && B.length >= 2) { const w = Math.min(A.length, B.length); tot += (mean1(A) - mean1(B)) * w; wsum += w; }
    });
    return wsum >= 3 ? tot / wsum : null;
  };
  p.stats.push({ label: 'Days taken', value: String(on.length), sub: 'since ' + shortDate(first) });
  p.stats.push({ label: 'Days without', value: String(off.length), sub: !off.length ? 'none yet' : offBefore ? offBefore + ' before starting' + (offOld ? ', ' + offOld + ' from older logs' : '') : 'while using it' });
  let h = '<div class="tr-chips tr-lag"><button type="button" class="tr-chip" data-tr="medold" aria-pressed="' + useOld + '">Include older logs (before 8 Oct)</button></div>';
  if (freeBefore) h += '<p class="small">You started ' + esc(name) + ' around ' + shortDate(freeBefore) + ', so logged days before that count as days without; ' + shortDate(freeBefore) + ' to ' + shortDate(first) + ' is left out (taken but maybe not logged).' + (offOld ? ' ' + offOld + ' of the days without are from the older logs, so treat them as rougher.' : '') + '</p>';
  else if (!priorOk) h += '<p class="small">' + esc(name) + ' wasn’t reliably logged before you started, so only days without it since then count.</p>';
  else if (offBefore) h += '<p class="small">' + (MED_NEVER_BEFORE.test(name) ? 'You hadn’t taken it before ' + shortDate(first) + ', so every earlier logged day counts as a day without.' : 'You logged it in the older records whenever you took it, so earlier days without it count.') + (offOld ? ' ' + offOld + ' of those are from the older logs (paper / Bearable / old daily sheet: fewer check-ins, some symptoms not rated), so treat them as rougher.' : '') + '</p>';
  if (d.supps) h += '<p class="pt-lead">Supplements (B12, D3 and the rest) mostly work over weeks, not day to day, so this table is unlikely to show much; the useful view comes after a month or two of steady use.</p>';
  if (asNeeded) h += '<p class="pt-lead">Taken when needed, usually because of pain, so its days look worse by design. The useful rows are the night and the next day.</p>';
  if (off.length < 3) {
    h += '<p class="pt-lead">You’ve taken it nearly every day, so there are too few days without it to compare' + (planSteps().some((st) => JSON.stringify(st).toLowerCase().includes(name.toLowerCase())) ? '. The Trials section compares before and after each change.' : '. A planned break (see Trials) is the way to see what it does.') + '</p>';
  }
  const rows = OUT.map((o) => {
    const A = vals(on, o.get), B = vals(off, o.get);
    if (A.length < 2 || B.length < 2) return null;
    const diff = mean1(A) - mean1(B), m = matched(o.get);
    return { o, diff, m, nA: A.length, nB: B.length };
  }).filter(Boolean);
  const big = (r) => (r.o.unit === 'min' ? 30 : r.o.unit === 'h' ? 0.5 : 0.7);
  const fmt = (r, v) => {
    if (v === null || v === undefined) return '–';
    const a = Math.abs(v), small = r.o.unit === 'min' ? a < 10 : r.o.unit === 'h' ? a < 0.2 : a < 0.3;
    if (small) return '≈';
    const better = r.o.worse === 0 ? null : (v * r.o.worse < 0);
    const arrow = better === null ? (r.o.unit === 'min' ? '' : v > 0 ? '+' : '−') : better ? '▲ ' : '▼ ';
    return arrow + (r.o.unit === 'min' ? Math.round(a) + ' min' + (better === null ? (v > 0 ? ' later' : ' earlier') : '') : r.o.unit === 'h' ? a.toFixed(1) + ' h' : a.toFixed(1));
  };
  const tone = (r, v) => { if (v === null || r.o.worse === 0) return 'same'; const a = Math.abs(v); if (a < (r.o.unit === 'h' ? 0.2 : 0.3)) return 'same'; return v * r.o.worse < 0 ? 'better' : 'worse'; };
  const pats = [];
  rows.forEach((r) => {
    const solid = r.nA >= 5 && r.nB >= 5 && Math.abs(r.diff) >= big(r) && (r.m === null || (Math.sign(r.m) === Math.sign(r.diff) && Math.abs(r.m) >= big(r) * 0.6));
    r.solid = solid;
    if (solid && r.o.worse !== 0) pats.push(r.o.name.toLowerCase() + ' ' + (r.diff * r.o.worse < 0 ? 'better' : 'worse') + (r.m !== null ? ' (also with a similar getting-up time)' : ''));
  });
  if (rows.length) {
    h += '<p class="pt-lead">' + (pats.length ? 'On days with ' + esc(name) + ': <b>' + esc(pats.join('; ')) + '</b>.' : off.length < 3 ? '' : 'Nothing clear yet: no measure differs by enough on enough days.') + '</p>';
    h += '<table class="pt-table pt-around pt-med"><thead><tr><th></th><th>' + (night ? 'Next day / night' : 'Days taken') + ' vs without</th><th>Same getting-up time</th></tr></thead><tbody>' + rows.map((r) =>
      '<tr><td>' + esc(r.o.name) + '</td><td class="' + tone(r, r.diff) + (r.solid ? ' top' : '') + '">' + fmt(r, r.diff) + '<small>' + r.nA + ' vs ' + r.nB + ' days</small></td><td class="' + tone(r, r.m) + '">' + fmt(r, r.m) + '</td></tr>').join('') + '</tbody></table>';
  }
  // What else was different on those days.
  const also = [];
  const upA = vals(on, upTime), upB = vals(off, upTime);
  if (upA.length >= 2 && upB.length >= 2 && Math.abs(mean1(upA) - mean1(upB)) >= 30) also.push('You got up ' + Math.round(Math.abs(mean1(upA) - mean1(upB))) + ' min ' + (mean1(upA) < mean1(upB) ? 'earlier' : 'later') + ' on days with it (out of bed ' + clockText(mean1(upA)) + ' vs ' + clockText(mean1(upB)) + ').');
  const slBefore = (x) => { const t = tgt(x); return t && typeof t.d.sl === 'number' ? t.d.sl : null; };
  const sA = vals(on, slBefore), sB = vals(off, slBefore);
  if (sA.length >= 2 && sB.length >= 2 && Math.abs(mean1(sA) - mean1(sB)) >= 0.5) also.push('The night before ' + (night ? 'the next day' : 'those days') + ' was ' + Math.abs(mean1(sA) - mean1(sB)).toFixed(1) + ' h ' + (mean1(sA) > mean1(sB) ? 'longer' : 'shorter') + ' on average.');
  Object.keys(data).filter((k) => k !== name && !data[k].supps).forEach((k) => {
    const both = on.filter((x) => data[k].byDay[x.key] > 0).length, offBoth = off.filter((x) => data[k].byDay[x.key] > 0).length;
    if (both >= Math.max(2, on.length * 0.5)) also.push(k + ' was also taken on ' + both + ' of the ' + on.length + ' days' + (off.length ? ' (and ' + offBoth + ' of the ' + off.length + ' days without)' : '') + (both >= on.length * 0.8 ? ', so their effects can’t be told apart here' : '') + '.' + (offOld && !(MED_NEVER_BEFORE.test(k) || MED_LOGGED_BEFORE.test(k) || MED_FREE_BEFORE[k.toLowerCase()]) ? ' (The older logs don’t record ' + k + ', so it may have been taken on some of those days too.)' : ''));
  });
  if (also.length) h += '<h3 class="pt-h">Also different on those days</h3><ul class="pt-list">' + also.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  // Since starting, if the first dose is inside the data and there are 2+ weeks before it.
  const before = list.filter((x) => x.key < first && x.key >= addDays(first, -28) && x.load !== null), after = list.filter((x) => x.key >= addDays(first, 3) && x.key <= addDays(last, 1) && x.load !== null);
  if (!priorOk && !freeBefore && before.length >= 10 && after.length >= 7) {
    const dv = avgLoad(after) - avgLoad(before);
    h += '<h3 class="pt-h">Since starting (' + shortDate(first) + ')</h3><p class="small">Day level ' + avgLoad(after).toFixed(1) + ' while taking it vs ' + avgLoad(before).toFixed(1) + ' in the 4 weeks before (' + (Math.abs(dv) < 0.3 ? 'about the same' : Math.abs(dv).toFixed(1) + ' ' + (dv < 0 ? 'better' : 'worse')) + '; ' + after.length + ' vs ' + before.length + ' days). Other changes in that time count too.</p>';
  }
  p.html = h;
  p.note = '▲ better, ▼ worse than days without it; + / − = higher / lower where neither is better. "Same getting-up time" compares only days with a similar time out of bed (before 10:30, 10:30–12:30, later), so a late start or a long lie-in doesn’t pass for the medicine. A pattern is only named from 5+ days each way with a clear difference that also holds with a similar getting-up time. Logged doses only: an unlogged dose counts as a day without. Patterns, not proof; check changes with your doctor or pharmacist.';
  return p;
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
  // v62: a phone can deliver one tap as two clicks (the second on the redrawn chart), which opened a night or day
  // and closed it again at once. The same tap target within 500 ms counts once.
  const sig = act + '|' + v, now = Date.now();
  if (TR.lastTap && TR.lastTap.sig === sig && now - TR.lastTap.at < 500) return;
  TR.lastTap = { sig, at: now };
  if (act === 'day') { TR.sel = TR.sel === v ? null : v; trendsRender(); if (TR.sel) loadDayDetail(TR.sel); }
  else if (act === 'series') {
    TR.on = TR.on.includes(v) ? TR.on.filter((x) => x !== v) : TR.on.concat(v);
    if (!TR.on.length) TR.on = ['load'];
    LS.set('trends.on', TR.on); trendsRender();
  }
  else if (act === 'inc') {
    TR.inc = TR.inc.includes(v) ? TR.inc.filter((x) => x !== v) : TR.inc.concat(v);
    if (!TR.inc.length) TR.inc = [v];
    LS.set('trends.inc3', TR.inc); trendsRender();
  }
  else if (act === 'sday') { TR.ssel = TR.ssel === v ? null : v; trendsRender(); if (TR.ssel) loadDayDetail(TR.ssel); }
  else if (act === 'pat') { TR.pop = v; TR.popFresh = true; trendsRender(); }
  else if (act === 'medrow') { TR.medOpen = TR.medOpen === v ? null : v; trendsRender(); }
  else if (act === 'gi') { TR.gi = v; LS.set('trends.gi2', v); trendsRender(); }
  else if (act === 'pgrid') { TR.pgrid = v; LS.set('trends.pgrid', v); trendsRender(); }
  else if (act === 'night') { TR.night = TR.night === v ? null : v; trendsRender(); }
  else if (act === 'actlag') { TR.actLag = Number(v); trendsRender(); }
  else if (act === 'actgroup') { TR.actGroup = v; trendsRender(); }
  else if (act === 'medold') { TR.medOld = TR.medOld === false; trendsRender(); }
  else if (act === 'sec') { TR.sec = v; TR.pop = null; LS.set('trends.sec', v); trendsRender(); const tabs = document.querySelector('.tr-tabs'); if (tabs && tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView(); }
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
  if (view === 'log') logRenderSoft();
  // v77: coming back to the app refreshes the health data whichever tab is showing (at most once a minute).
  if (Conn.canLog() && (tabOn('log') || tabOn('trends')) && Date.now() - (cfg.at || 0) > 60000) logRefreshConfig();
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
showView(openTab());
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
