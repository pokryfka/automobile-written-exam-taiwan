/* global Core */
'use strict';

const STATS_FILE = 'taiwan-car-exam-stats.json';
const REPO_URL = 'https://github.com/pokryfka/car-exam-tw';
const SUPPORT_URL = REPO_URL + '/issues';
// The Highway Bureau's own online mock exam for cars and motorcycles.
const OFFICIAL_PRACTICE_URL = 'https://www.mvdis.gov.tw/m3-simulator-drv/index';
// Mock exam rules of the car written test since 30 June 2026 (民國115年6月30日), as on the
// Highway Bureau's practice test: 50 random questions, including 5 hazard-perception video
// questions, 2 points each, 85 points to pass.
const EXAM = { size: 50, hazard: 5, points: 2, pass: 85 };
// Time limits offered for the mock exam, in minutes (0 is no limit). The official test allows
// 30 minutes; a warning shows when EXAM_WARN_MINUTES are left.
const EXAM_TIME_LIMITS = [0, 10, 20, 30];
const OFFICIAL_EXAM_MINUTES = 30;
const EXAM_WARN_MINUTES = 5;
const view = document.getElementById('view');

// ---------- storage ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
};

const state = {
  questions: [],
  byId: {},
  deviceId: store.get('deviceId', null),
  myStats: store.get('myStats', {}),
  remoteDoc: store.get('remoteDoc', { version: 1, devices: {} }),
  // Features of this deployment from /api/config, kept for offline use. Gist sync is offered
  // only where enabled (QA), but a device already using it keeps it.
  config: store.get('config', { gistSync: false }),
  // The running app's version, from version.json written at deploy time (see tools/write_version.mjs).
  version: { version: 'dev', commit: null, environment: 'dev' },
  languages: [], // [{ code, name }] from bank.json; the first is the reference (English)
  text: {}, // language code -> { sections, topics, questions: { [id]: { q, options } } }
  hazard: null, // hazard-perception video questions from data/hazard.json, added to questions
  settings: Object.assign({
    syncMode: '', syncCode: '', token: '', gistId: '', deviceName: '', section: '', topic: '', length: 20,
    examMinutes: OFFICIAL_EXAM_MINUTES, // mock exam time limit, 0 for none
    textSize: 'standard', // one of TEXT_SIZES, this device only
    uiLang: 'en', // interface language
    secondLang: 'en', // language offered next to Chinese on each question
    questionLang: 'en', // language the next question opens in
    prefsUpdated: 0, // when the three language choices above last changed; synced between devices
  }, store.get('settings', {})),
  session: null,
};

// Ids must match the sync server's pattern; older random ids could rarely be too short.
if (!/^[a-z0-9]{4,32}$/.test(state.deviceId || '')) {
  state.deviceId = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 10);
  store.set('deviceId', state.deviceId);
}
// Before sync codes existed, a saved token meant Gist sync.
if (!state.settings.syncMode && state.settings.token) state.settings.syncMode = 'gist';
function saveSettings() { store.set('settings', state.settings); }

// ---------- interface language ----------
// Interface strings live in one file per language (i18n/<code>.json), with {name} placeholders.
// English is always loaded as the fallback for strings missing in another language.
// To add a language: add its file and an entry here.

const UI_LANGS = [
  { code: 'en', name: 'English', locale: 'en', flag: 'gb' },
  { code: 'zh-Hant', name: '繁體中文（台灣）', locale: 'zh-TW', flag: 'tw' },
];

// Flags are inline SVG rather than emoji, which Windows shows as two letters. Drawn at 3:2.
let flagIds = 0;
const FLAGS = {
  gb: () => {
    const id = 'f' + flagIds++;
    return `<clipPath id="${id}a"><path d="M0 0v30h60V0z"/></clipPath>`
      + `<clipPath id="${id}b"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath>`
      + `<g clip-path="url(#${id}a)"><path d="M0 0v30h60V0z" fill="#012169"/>`
      + '<path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>'
      + `<path d="M0 0l60 30m0-30L0 30" clip-path="url(#${id}b)" stroke="#C8102E" stroke-width="4"/>`
      + '<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>'
      + '<path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g>';
  },
  tw: () => {
    // Red field, blue canton, white sun with 12 rays.
    const rays = [];
    for (let i = 0; i < 24; i++) {
      const r = i % 2 ? 9.5 : 15, a = (i * Math.PI) / 12 - Math.PI / 2;
      rays.push((15 + r * Math.cos(a)).toFixed(2) + ' ' + (10 + r * Math.sin(a)).toFixed(2));
    }
    return '<path d="M0 0h60v40H0z" fill="#FE0000"/><path d="M0 0h30v20H0z" fill="#000095"/>'
      + `<path d="M${rays.join('L')}z" fill="#fff"/>`
      + '<circle cx="15" cy="10" r="5.6" fill="#000095"/><circle cx="15" cy="10" r="4.8" fill="#fff"/>';
  },
};
const FLAG_VIEWBOX = { gb: '0 0 60 30', tw: '0 0 60 40' };

function flagIcon(flag) {
  const span = document.createElement('span');
  span.className = 'flag';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="${FLAG_VIEWBOX[flag]}" preserveAspectRatio="xMidYMid slice">${FLAGS[flag]()}</svg>`;
  return span;
}

const ui = { lang: 'en', strings: {}, fallback: {} };

// Interface text is "live": t() returns an object that turns into the string in the current
// language whenever it is used. Elements built with h() remember the live text they show, and
// switching the language only updates that text in place (see refreshLive), so the screen,
// scroll position, typed input and answers stay as they are.
class Live {
  constructor(fn) { this.fn = fn; }
  toString() { return this.fn(); }
}

function live(fn) {
  return new Live(fn);
}

// The string now, for logic and comparisons.
function tr(key, vars) {
  const s = ui.strings[key] ?? ui.fallback[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

function t(key, vars) {
  return live(() => tr(key, vars));
}

// Text nodes and attributes showing live text; pruned of detached nodes after each render.
let liveNodes = [];

function liveText(text) {
  const node = document.createTextNode(String(text));
  if (text instanceof Live) liveNodes.push({ node, text });
  return node;
}

function refreshLive() {
  for (const { node, attr, text } of liveNodes) {
    if (attr) node.setAttribute(attr, String(text)); else node.data = String(text);
  }
}

function uiLocale() {
  return (UI_LANGS.find(l => l.code === ui.lang) || UI_LANGS[0]).locale;
}

// The saved choice, else English.
function preferredUiLang() {
  return UI_LANGS.some(l => l.code === state.settings.uiLang) ? state.settings.uiLang : 'en';
}

async function loadStrings(code) {
  try {
    const res = await fetch('i18n/' + code + '.json');
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null; // offline and not cached yet
  }
}

async function setUiLang(code) {
  if (!Object.keys(ui.fallback).length) ui.fallback = (await loadStrings('en')) || {};
  const strings = code === 'en' ? ui.fallback : await loadStrings(code);
  if (!strings) return false;
  ui.lang = code;
  ui.strings = strings;
  document.documentElement.lang = uiLocale();
  document.title = tr('app.title');
  document.getElementById('title').textContent = tr('app.title');
  document.querySelector('[data-view=home]').setAttribute('aria-label', t('nav.home'));
  document.querySelector('[data-view=settings]').setAttribute('aria-label', t('nav.settings'));
  document.getElementById('sync-dot').title = String(sync.lastMessage || tr('sync.statusLabel'));
  const current = UI_LANGS.find(l => l.code === code);
  const button = document.getElementById('lang-btn');
  button.replaceChildren(flagIcon(current.flag));
  button.setAttribute('aria-label', tr('settings.appLanguage') + ': ' + current.name);
  setTextSize(state.settings.textSize);
  refreshLive();
  return true;
}

// Top-bar menus: a button showing the current choice opens a list of all of them.
const topMenus = [];

function topMenu(buttonId, menuId, { items, choose }) {
  const m = {
    button: document.getElementById(buttonId),
    menu: document.getElementById(menuId),
    open() {
      topMenus.forEach(other => other !== m && other.close(false));
      this.menu.replaceChildren(...items().map(item => h('button', {
        role: 'menuitemradio',
        'aria-checked': String(item.current),
        lang: item.lang || null,
        onclick: () => { this.close(true); if (!item.current) choose(item.value); },
      }, item.icon, h('span', { class: 'name' }, item.name), h('span', { class: 'check' }, item.current ? '✓' : ''))));
      this.menu.hidden = false;
      this.button.setAttribute('aria-expanded', 'true');
      (this.menu.querySelector('[aria-checked="true"]') || this.menu.firstChild).focus();
    },
    close(focusButton) {
      if (this.menu.hidden) return;
      this.menu.hidden = true;
      this.button.setAttribute('aria-expanded', 'false');
      if (focusButton) this.button.focus();
    },
  };
  m.button.addEventListener('click', e => {
    e.stopPropagation();
    if (m.menu.hidden) m.open(); else m.close(false);
  });
  topMenus.push(m);
  return m;
}

document.addEventListener('click', e => topMenus.forEach(m => { if (!m.menu.contains(e.target)) m.close(false); }));
document.addEventListener('keydown', e => {
  const m = topMenus.find(x => !x.menu.hidden);
  if (!m) return;
  // An open menu handles its keys; the screen's shortcuts must not see them too.
  e.stopImmediatePropagation();
  if (e.key === 'Escape') m.close(true);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...m.menu.children];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
});

// Interface language: the current language's flag.
topMenu('lang-btn', 'lang-menu', {
  items: () => UI_LANGS.map(l => ({ value: l.code, current: l.code === ui.lang, lang: l.locale, icon: flagIcon(l.flag), name: l.name })),
  async choose(code) {
    if (!(await setUiLang(code))) {
      alert(t('settings.downloadFailed', { language: UI_LANGS.find(l => l.code === code).name }));
      return;
    }
    state.settings.uiLang = code;
    prefsChanged();
  },
});

// Text size: scales all text in the page in place (the stylesheet sizes text in rem). Saved on
// this device only, since the right size depends on the screen.
const TEXT_SIZES = [
  { value: 'standard', label: 'textSize.standard' },
  { value: 'large', label: 'textSize.large' },
  { value: 'larger', label: 'textSize.larger' },
];

// Three letters of growing size, the current one highlighted.
function textSizeIcon(current) {
  return h('span', { class: 'text-size-icon', 'aria-hidden': 'true' },
    TEXT_SIZES.map(size => h('span', { class: size.value === current ? 'on' : '' }, 'A')));
}

function setTextSize(value) {
  const size = TEXT_SIZES.find(x => x.value === value) || TEXT_SIZES[0];
  document.documentElement.dataset.textSize = size.value;
  const button = document.getElementById('text-size-btn');
  button.replaceChildren(textSizeIcon(size.value));
  button.setAttribute('aria-label', String(t('textSize.label')) + ': ' + String(t(size.label)));
}

document.documentElement.dataset.textSize = state.settings.textSize;

topMenu('text-size-btn', 'text-size-menu', {
  items: () => TEXT_SIZES.map(size => ({
    value: size.value,
    current: size.value === document.documentElement.dataset.textSize,
    icon: h('span', { class: 'text-size-sample ' + size.value, 'aria-hidden': 'true' }, 'Aa'),
    name: t(size.label),
  })),
  choose(value) {
    setTextSize(value);
    state.settings.textSize = value;
    saveSettings();
  },
});

function defaultDeviceName() {
  // A touch screen as the main pointer means a phone or tablet; the smaller screen side tells them apart.
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return tr(!touch ? 'device.computer' : Math.min(screen.width, screen.height) < 600 ? 'device.phone' : 'device.tablet');
}

function randomString(alphabet, length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

function allStats() {
  const devices = Object.assign({}, state.remoteDoc.devices);
  devices[state.deviceId] = { stats: state.myStats };
  return Core.mergeDevices(devices);
}

// ---------- question text ----------
// Question text lives in one file per language (data/text/<code>.json), keyed by question id.
// Each question can be switched between Chinese, the official language of the test, and one
// second language chosen in settings. English, the reference edition of the extracted data,
// is always loaded: it is the fallback for questions, section names and topic names missing
// in the other languages. The interface language is chosen separately (see above).

const REFERENCE_LANG = 'en';
const PRIMARY_LANG = 'zh-Hant';

function available(code) {
  return state.languages.some(l => l.code === code);
}

function secondLang() {
  const code = state.settings.secondLang;
  return code !== PRIMARY_LANG && available(code) ? code : REFERENCE_LANG;
}

function enabledLangs() {
  return [PRIMARY_LANG, secondLang()].filter(available);
}

function textFor(q, lang) {
  const t = state.text[lang];
  return t && t.questions[q.id];
}

// The language a question is shown in: the wanted one if it has a translation,
// else the other enabled language, else English.
function shownLang(q, lang) {
  return [lang].concat(enabledLangs(), REFERENCE_LANG).find(code => textFor(q, code));
}

function qText(q, lang) {
  return textFor(q, shownLang(q, lang || state.settings.questionLang));
}

// Short label for the question language toggle.
function langLabel(code) {
  if (code === REFERENCE_LANG) return 'EN';
  const l = state.languages.find(x => x.code === code);
  return l ? l.name : code;
}

// Language name in the interface language, for sentences and settings.
function langName(code) {
  return live(() => {
    const name = tr('lang.' + code);
    return name === 'lang.' + code ? langLabel(code) : name;
  });
}

// Section and topic names follow the interface language when the question bank has them.
function bankName(kind, key) {
  for (const code of [ui.lang, REFERENCE_LANG]) {
    const text = state.text[code];
    if (text && text[kind][key]) return displayCase(text[kind][key]);
  }
  return key;
}

// The English bank prints section names in capitals ("SECTION 1 CORRECT CONCEPTS AND ETHICS");
// show them in title case like the topics: "Section 1: Correct Concepts and Ethics".
const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function displayCase(name) {
  if (!/[A-Z]/.test(name) || name !== name.toUpperCase()) return name;
  return name.toLowerCase()
    .replace(/[a-z][a-z'-]*/g, (word, i) => (i > 0 && MINOR_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .replace(/^(Section \d+) /, '$1: ');
}

function sectionName(key) {
  return live(() => bankName('sections', key));
}

function topicName(key) {
  return live(() => bankName('topics', key));
}

async function loadText(code) {
  if (state.text[code]) return true;
  try {
    const res = await fetch('data/text/' + code + '.json');
    if (!res.ok) return false;
    state.text[code] = await res.json();
    addHazardText(code);
    return true;
  } catch (e) {
    return false; // offline and not cached yet
  }
}

// The hazard-perception questions keep their text in data/hazard.json; add it to a loaded language.
function addHazardText(code) {
  const text = state.text[code];
  if (!state.hazard || !text || !state.hazard.sections[code]) return;
  text.sections.hazard = state.hazard.sections[code];
  for (const q of state.hazard.questions) if (q.text[code]) text.questions[q.id] = q.text[code];
}

async function loadHazard() {
  try {
    const res = await fetch('data/hazard.json');
    if (!res.ok) return;
    state.hazard = await res.json();
  } catch (e) { return; } // offline without cache
  for (const q of state.hazard.questions) {
    const { text, ...rest } = q;
    state.questions.push({ ...rest, section: 'hazard', hazard: true });
  }
  Object.keys(state.text).forEach(addHazardText);
}

function pool() {
  const { section, topic } = state.settings;
  return state.questions.filter(q => (!section || q.section === section) && (!topic || q.topic === topic));
}

// ---------- language choices ----------
// The interface language, second question language and last question language are synced
// between devices: each device sends its choices with the time they last changed, and the
// most recent choices from any device win.

function currentPrefs() {
  return {
    uiLang: ui.lang,
    secondLang: secondLang(),
    questionLang: state.settings.questionLang,
    updated: state.settings.prefsUpdated || 0,
  };
}

// Call after the user changes a language choice on this device.
function prefsChanged() {
  state.settings.prefsUpdated = Date.now();
  saveSettings();
  sync.soon();
}

// Apply newer choices made on another device. Returns true if anything was applied.
async function adoptPrefs(devices) {
  let latest = null;
  for (const [id, d] of Object.entries(devices || {})) {
    const p = d && d.prefs;
    if (id !== state.deviceId && p && (p.updated || 0) > (latest ? latest.updated : state.settings.prefsUpdated || 0)) latest = p;
  }
  if (!latest) return false;
  if (latest.secondLang && available(latest.secondLang) && await loadText(latest.secondLang)) state.settings.secondLang = latest.secondLang;
  if (latest.questionLang && available(latest.questionLang)) state.settings.questionLang = latest.questionLang;
  if (latest.uiLang && latest.uiLang !== ui.lang && UI_LANGS.some(l => l.code === latest.uiLang)
    && await setUiLang(latest.uiLang)) state.settings.uiLang = latest.uiLang;
  state.settings.prefsUpdated = latest.updated;
  saveSettings();
  return true;
}

// ---------- sync ----------
// Two backends share one document shape, { devices: { [deviceId]: { name, updated, stats } } },
// in which each device writes only its own entry:
//   'code': this site's sync API, keyed by a random sync code (no account needed)
//   'gist': a private GitHub Gist in the user's own account

// Crockford base32: no I, L, O or U, so codes are easy to read and type.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newSyncCode() {
  return randomString(CODE_ALPHABET, 12);
}

function formatCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

function normaliseCode(input) {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : null;
}

const gist = {
  async api(path, opts) {
    const res = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + state.settings.token,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }));
    if (!res.ok) {
      const hint = [401, 403, 404].includes(res.status) && t('gist.error' + res.status);
      throw new Error('GitHub ' + res.status + (hint ? ': ' + hint : ' ' + (await res.text()).slice(0, 120)));
    }
    return res.json();
  },
  async findOrCreate() {
    if (state.settings.gistId) return state.settings.gistId;
    for (let page = 1; page <= 10; page++) {
      const gists = await gist.api('/gists?per_page=100&page=' + page);
      const hit = gists.find(g => g.files && g.files[STATS_FILE]);
      if (hit) { state.settings.gistId = hit.id; saveSettings(); return hit.id; }
      if (gists.length < 100) break;
    }
    const created = await gist.api('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Car written exam practice stats',
        public: false,
        files: { [STATS_FILE]: { content: JSON.stringify({ version: 1, devices: {} }) } },
      }),
    });
    state.settings.gistId = created.id;
    saveSettings();
    return created.id;
  },
  async push(entry) {
    const id = await gist.findOrCreate();
    const data = await gist.api('/gists/' + id);
    const file = data.files[STATS_FILE];
    let text = file ? file.content : '';
    if (file && file.truncated) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
    let doc;
    try { doc = JSON.parse(text); } catch (e) { doc = null; }
    if (!doc || typeof doc.devices !== 'object') doc = { version: 1, devices: {} };
    doc.devices[state.deviceId] = entry;
    await gist.api('/gists/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [STATS_FILE]: { content: JSON.stringify(doc) } } }),
    });
    return doc;
  },
};

const codeSync = {
  async push(entry) {
    const res = await fetch('api/sync/' + state.settings.syncCode + '/' + state.deviceId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: entry.name, stats: entry.stats, prefs: entry.prefs }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status + (body.error ? ': ' + body.error : ''));
    return { version: 1, devices: body.devices || {} };
  },
};

const sync = {
  timer: null,
  busy: false,
  lastMessage: '',
  lastKind: '',
  status(kind, msg) {
    const dot = document.getElementById('sync-dot');
    dot.className = 'sync-dot ' + (kind || '');
    dot.title = String(msg || '');
    sync.lastMessage = msg || '';
    sync.lastKind = kind || '';
  },
  backend() {
    const { syncMode, syncCode, token } = state.settings;
    if (syncMode === 'code' && syncCode) return codeSync;
    if (syncMode === 'gist' && token) return gist;
    return null;
  },
  async run() {
    const backend = sync.backend();
    if (!backend || sync.busy || !navigator.onLine) return;
    sync.busy = true;
    sync.status('busy', t('sync.syncing'));
    try {
      const entry = { name: state.settings.deviceName, updated: Date.now(), stats: state.myStats, prefs: currentPrefs() };
      const doc = await backend.push(entry);
      if (backend !== sync.backend()) return; // settings changed while syncing
      state.remoteDoc = doc;
      store.set('remoteDoc', doc);
      store.set('lastSync', Date.now());
      const adopted = await adoptPrefs(doc.devices);
      sync.status('ok', t('sync.synced', { time: new Date().toLocaleTimeString(uiLocale()) }));
      if (state.view === 'home') homeView();
      else if (adopted) {
        // Settings show the second language as a choice; the rest updates in place.
        const select = document.getElementById('second-lang');
        if (select) select.value = secondLang();
      }
    } catch (e) {
      sync.status('err', t('sync.failed', { error: e.message }));
    } finally {
      sync.busy = false;
    }
  },
  soon() {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(sync.run, 4000);
  },
  // Switch backend: the other devices' stats come from the new backend on the next sync.
  configure(changes) {
    Object.assign(state.settings, changes);
    saveSettings();
    state.remoteDoc = { version: 1, devices: {} };
    store.set('remoteDoc', state.remoteDoc);
    sync.status('', '');
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(sync.timer); sync.run(); }
  else sync.run();
});
window.addEventListener('online', () => sync.run());

// ---------- rendering helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v instanceof Live) {
      el.setAttribute(k, String(v));
      liveNodes.push({ node: el, attr: k, text: v });
    } else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : liveText(c));
  }
  return el;
}

function render(...nodes) {
  keyboard.bindings = [];
  view.replaceChildren(...nodes.filter(n => n != null && n !== false));
  liveNodes = liveNodes.filter(e => e.node.isConnected);
  window.scrollTo(0, 0);
}

function questionLabel(q) {
  if (q.hazard) return live(() => bankName('sections', 'hazard') + ' #' + q.no);
  return live(() => '#' + q.no + (q.also ? ' (' + tr('question.also', { numbers: q.also.join(', #') }) + ')' : '')
    + (q.topic ? ' · ' + bankName('topics', q.topic).replace(/\s*[(（].*[)）]$/, '') : ''));
}

// ---------- keyboard ----------
// Each screen registers its shortcuts with setKeys(); they press the screen's own buttons, so a
// key does exactly what tapping does. Hints are shown only when a keyboard seems to be there:
// a fine pointer with hover (a computer), or once a key has been pressed (a tablet keyboard).

const keyboard = { used: false, bindings: [] };
const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');

function updateKeyboardClass() {
  document.body.classList.toggle('kbd', keyboard.used || finePointer.matches);
}

function press(el) {
  if (el && !el.disabled) el.click();
}

function kbd(text) {
  return h('kbd', {}, text);
}

// bindings: [{ keys: ['1', '2'], show: '1–2', label: 'keys.answer', run(key), when() }]
// Letter keys are given in lower case. Adds the hint line for this screen at the end of the view.
function setKeys(bindings) {
  keyboard.bindings = bindings.filter(b => !b.when || b.when());
  view.append(h('p', { class: 'key-hints kbd-only' },
    keyboard.bindings.flatMap(b => [kbd(b.show), ' ', t(b.label), ' · ']),
    kbd('?'), ' ', t('keys.all')));
}

function toggleKeyHelp() {
  const open = document.querySelector('.key-overlay');
  if (open) return open.remove();
  const rows = keyboard.bindings.map(b => [b.show, b.label]).concat([['?', 'keys.help'], ['Esc', 'keys.close']]);
  const overlay = h('div', { class: 'key-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('keys.title'),
    onclick: e => { if (e.target === overlay) overlay.remove(); } },
  h('div', { class: 'card' },
    h('h2', {}, t('keys.title')),
    h('table', { class: 'keys' }, rows.map(([show, label]) => h('tr', {}, h('th', {}, kbd(show)), h('td', {}, t(label)))))));
  document.body.append(overlay);
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, select, textarea')) return;
  if (!keyboard.used) {
    keyboard.used = true;
    updateKeyboardClass();
  }
  if (e.key === '?') {
    e.preventDefault();
    toggleKeyHelp();
    return;
  }
  const overlay = document.querySelector('.key-overlay');
  if (overlay) {
    if (e.key === 'Escape') overlay.remove();
    return;
  }
  // Enter and Space already press a focused button or link (a disabled one, like an answered
  // option, does nothing, so the screen's shortcut applies).
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button:not(:disabled), a')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const binding = keyboard.bindings.find(b => b.keys.includes(key));
  if (!binding || (e.repeat && !binding.repeat)) return;
  e.preventDefault();
  binding.run(key);
});

finePointer.addEventListener('change', updateKeyboardClass);

function goHome() {
  state.session = null;
  homeView();
}

// The question language key switches to the other enabled language, like the 中文 / EN toggle.
function languageKey(toggle) {
  return {
    keys: ['l'], show: 'L', label: 'keys.language', when: () => !!toggle,
    run: () => press([...toggle.querySelectorAll('button')].find(b => !b.classList.contains('on'))),
  };
}

// ---------- views ----------

function homeView() {
  state.view = 'home';
  if (!state.questions.length) {
    return render(h('div', { class: 'card' },
      h('h2', {}, t('home.noBank')),
      h('p', {}, t('home.noBankHelp'))));
  }
  const stats = allStats();
  const qs = pool();
  const s = Core.summary(qs, stats);
  const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
  const accuracy = s.right + s.wrong ? Math.round((s.right / (s.right + s.wrong)) * 100) + '%' : '–';
  const unique = list => [...new Set(list.filter(Boolean))];
  const sections = unique(state.questions.map(q => q.section));
  const topics = unique(state.questions.filter(q => !state.settings.section || q.section === state.settings.section).map(q => q.topic));
  const len = state.settings.length;

  const start = (mode) => () => {
    const picked = Core.pickQuestions(qs, stats, mode, len);
    if (!picked.length) {
      alert(t(mode === 'weak' ? 'home.noWeak' : 'home.nothingLeft'));
      return;
    }
    startSession(picked.map(q => q.id), mode, false);
  };

  render(
    h('div', { class: 'card' },
      h('div', { class: 'stats-row' },
        h('div', {}, h('b', {}, s.seen), h('span', {}, t('home.seen', { total: s.total }))),
        h('div', {}, h('b', {}, s.mastered), h('span', {}, t('home.mastered'))),
        h('div', {}, h('b', {}, s.weak), h('span', {}, t('home.toReview'))),
        h('div', {}, h('b', {}, accuracy), h('span', {}, t('home.accuracy')))),
      h('div', { class: 'progress' }, h('div', { style: 'width:' + pct + '%' })),
      h('p', { class: 'muted' }, t('home.masteredPct', { pct }))),
    h('div', { class: 'card' },
      h('h2', {}, t('home.practice')),
      h('div', { class: 'modes' },
        h('button', { onclick: start('smart') }, h('b', {}, t('home.smart')), h('small', {}, t('home.smartHint')), modeKey(1)),
        h('button', { onclick: start('weak') }, h('b', {}, t('home.weak')), h('small', {}, t('home.weakHint')), modeKey(2)),
        h('button', { onclick: start('unseen') }, h('b', {}, t('home.unseen')), h('small', {}, t('home.unseenHint')), modeKey(3)),
        h('button', { onclick: start('random') }, h('b', {}, t('home.random')), h('small', {}, t('home.randomHint')), modeKey(4)),
        h('button', {
          onclick: () => startSession(Core.pickExam(state.questions, EXAM).map(q => q.id), 'exam', true),
        }, h('b', {}, t('home.exam')), h('small', {}, state.settings.examMinutes
          ? t('home.examHintTimed', { size: EXAM.size, pass: EXAM.pass, minutes: state.settings.examMinutes })
          : t('home.examHint', { size: EXAM.size, pass: EXAM.pass })), modeKey(5)),
        h('button', { onclick: weakListView }, h('b', {}, t('home.weakList')), h('small', {}, t('home.weakListHint')), modeKey(6))),
      h('label', { for: 'len' }, t('home.length')),
      h('select', {
        id: 'len',
        onchange: e => { state.settings.length = +e.target.value; saveSettings(); },
      }, [10, 20, 40, 80].map(n => h('option', { value: n, selected: n === len }, n))),
      h('label', { for: 'section' }, t('home.section')),
      h('select', {
        id: 'section',
        onchange: e => { state.settings.section = e.target.value; state.settings.topic = ''; saveSettings(); homeView(); },
      }, h('option', { value: '' }, t('home.allSections')),
      sections.map(c => h('option', { value: c, selected: c === state.settings.section }, sectionName(c)))),
      h('label', { for: 'topic' }, t('home.topic')),
      h('select', {
        id: 'topic',
        onchange: e => { state.settings.topic = e.target.value; saveSettings(); homeView(); },
      }, h('option', { value: '' }, t('home.allTopics')),
      topics.map(c => h('option', { value: c, selected: c === state.settings.topic }, topicName(c)))),
      h('p', { class: 'muted' }, t('home.filtersHint'))),
    h('div', { class: 'card' },
      h('h2', {}, t('home.official')),
      h('p', { class: 'muted' }, t('home.officialHelp')),
      h('a', { class: 'btn link-btn', href: OFFICIAL_PRACTICE_URL, target: '_blank', rel: 'noopener' }, t('home.officialOpen'))),
    !sync.backend() && h('div', { class: 'card' },
      h('p', { class: 'muted' }, t('home.noSync'))),
  );
  const modeButtons = [...view.querySelectorAll('.modes button')];
  setKeys([{ keys: ['1', '2', '3', '4', '5', '6'], show: '1–6', label: 'keys.mode', run: key => press(modeButtons[key - 1]) }]);
}

function modeKey(n) {
  return h('kbd', { class: 'kbd-only mode-key' }, String(n));
}

function weakListView() {
  state.view = 'weak';
  const stats = allStats();
  const rows = pool()
    .filter(q => stats[q.id] && (stats[q.id].w > 0 || stats[q.id].u > 0))
    .map(q => ({ q, r: stats[q.id], score: Core.weakness(stats[q.id]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  render(h('div', { class: 'card' },
    h('h2', {}, t('weak.title')),
    rows.length
      ? [
        h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:10px', onclick: () => startSession(rows.slice(0, state.settings.length).map(x => x.q.id), 'weak', false) }, t('weak.practice')),
        h('table', { class: 'weak' }, rows.map(({ q, r }) => h('tr', {},
          h('td', {}, h('div', { class: 'muted' }, questionLabel(q)),
            (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })), qText(q).q),
          h('td', { class: 'num' }, statLabel(r))))),
      ]
      : h('p', { class: 'muted' }, t('weak.none'))));
  setKeys([
    { keys: ['Enter'], show: 'Enter', label: 'keys.practice', when: () => rows.length > 0, run: () => press(view.querySelector('.btn.primary')) },
    { keys: ['Escape'], show: 'Esc', label: 'keys.home', run: goHome },
  ]);
}

function startSession(ids, mode, exam) {
  state.session = { ids, idx: 0, mode, exam, results: [] };
  if (!exam) return questionView();
  // The mock exam works like the official test: answers can be changed until it is handed in.
  Object.assign(state.session, { answers: ids.map(() => null), unsure: ids.map(() => false), started: Date.now() });
  const minutes = state.settings.examMinutes;
  if (minutes) {
    state.session.deadline = state.session.started + minutes * 60000;
    startExamClock(state.session);
  }
  examView();
}

// The mock exam screen: move freely between questions, choose or change answers, then hand in
// all of them once. Nothing is recorded in the stats until then.
function examView() {
  state.view = 'exam';
  const s = state.session;
  const q = state.byId[s.ids[s.idx]];
  let lang = shownLang(q, state.settings.questionLang);
  const go = idx => { s.idx = idx; examView(); };

  const stem = h('p', { class: 'qtext' });
  const labels = [0, 1, 2].map(() => h('span', {}));
  const buttons = [0, 1, 2].map(i => h('button', {
    class: s.answers[s.idx] === i ? 'chosen' : '',
    'aria-pressed': String(s.answers[s.idx] === i),
    onclick: () => { s.answers[s.idx] = i; examView(); },
  }, labels[i], q.optionImages && h('img', { class: 'optimg', src: 'data/' + q.optionImages[i], alt: t('q.option', { n: i + 1 }) })));

  const langs = enabledLangs();
  const toggle = langs.length > 1 && h('div', { class: 'lang-toggle', role: 'group', 'aria-label': t('q.languageGroup') },
    langs.map(code => h('button', {
      'data-lang': code,
      disabled: !textFor(q, code),
      title: textFor(q, code) ? '' : t('q.notAvailable', { language: langName(code) }),
      onclick: () => { state.settings.questionLang = code; prefsChanged(); showText(code); },
    }, langLabel(code))));
  function showText(code) {
    lang = shownLang(q, code);
    stem.textContent = textFor(q, lang).q;
    stem.lang = lang;
    labels.forEach((el, i) => { el.textContent = '(' + (i + 1) + ') ' + textFor(q, lang).options[i]; el.lang = lang; });
    if (toggle) toggle.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
  }
  showText(lang);

  const answered = s.answers.filter(a => a !== null).length;
  const grid = h('div', { class: 'exam-grid', role: 'navigation', 'aria-label': t('exam.questions') },
    s.ids.map((id, i) => h('button', {
      class: [s.answers[i] === null ? '' : s.unsure[i] ? 'unsure' : 'answered', i === s.idx ? 'current' : ''].join(' ').trim(),
      'aria-current': i === s.idx ? 'step' : null,
      'aria-label': t(s.answers[i] === null ? 'exam.cellUnanswered' : s.unsure[i] ? 'exam.cellUnsure' : 'exam.cellAnswered', { n: i + 1 }),
      onclick: () => go(i),
    }, String(i + 1))));

  render(h('div', { class: 'card' },
    h('div', { class: 'qmeta' },
      h('span', {}, t('exam.position', { n: s.idx + 1, total: s.ids.length }),
        s.deadline && [' · ', h('span', {
          id: 'exam-clock',
          class: 'exam-clock' + (s.deadline - Date.now() <= EXAM_WARN_MINUTES * 60000 ? ' warn' : ''),
          'aria-label': t('exam.timeLeft'),
        }, formatDuration(s.deadline - Date.now()))]),
      toggle),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, questionLabel(q)),
    (q.images || []).map(src => h('img', { class: 'qimg', src: 'data/' + src, alt: t('q.illustration') })),
    videoLink(q),
    stem,
    h('div', { class: 'options' + (q.optionImages ? ' pics' : '') }, buttons),
    h('div', { class: 'unsure-row' }, h('button', {
      class: 'unsure-toggle' + (s.unsure[s.idx] ? ' on' : ''),
      'aria-pressed': String(s.unsure[s.idx]),
      onclick: () => { s.unsure[s.idx] = !s.unsure[s.idx]; examView(); },
    }, t('q.unsure'))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: s.idx === 0, onclick: () => go(s.idx - 1) }, t('exam.previous')),
      h('button', { class: 'btn', disabled: s.idx === s.ids.length - 1, onclick: () => go(s.idx + 1) }, t('exam.next')))),
  h('div', { class: 'card' },
    h('div', { class: 'exam-legend muted' },
      h('span', {}, t('exam.answeredCount', { count: answered, total: s.ids.length })),
      h('span', { class: 'key answered' }, t('exam.keyAnswered')),
      h('span', { class: 'key unsure' }, t('exam.keyUnsure')),
      h('span', { class: 'key' }, t('exam.keyUnanswered'))),
    grid,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const left = s.ids.length - answered;
          if (left && !confirm(t('exam.confirmFinish', { count: left }))) return;
          submitExam(s);
        },
      }, t('exam.finish')))));
  const [prev, next] = view.querySelectorAll('.card:first-child .actions button');
  setKeys([
    { keys: ['1', '2', '3'], show: '1–3', label: 'keys.answer', run: key => press(buttons[key - 1]) },
    { keys: ['/'], show: '/', label: 'keys.unsure', run: () => press(view.querySelector('.unsure-toggle')) },
    languageKey(toggle),
    { keys: ['ArrowLeft', 'ArrowRight'], show: '← →', label: 'keys.prevNext', repeat: true, run: key => press(key === 'ArrowLeft' ? prev : next) },
    {
      keys: ['n'], show: 'N', label: 'keys.nextUnanswered',
      run: () => {
        const order = s.ids.map((_, i) => (s.idx + 1 + i) % s.ids.length);
        const i = order.find(j => s.answers[j] === null);
        if (i !== undefined) go(i);
      },
    },
    { keys: ['f'], show: 'F', label: 'keys.finish', run: () => press(view.querySelector('.btn.primary')) },
  ]);
  window.scrollTo(0, 0);
}

// Hand in the mock exam: record every answered question in the stats, then show the result.
function submitExam(s) {
  const now = Date.now();
  s.finished = now;
  s.results = [];
  s.ids.forEach((id, i) => {
    if (s.answers[i] === null) return;
    const correct = s.answers[i] === state.byId[id].answer;
    Core.recordAnswer(state.myStats, id, correct, now, s.unsure[i]);
    s.results.push({ id, correct });
  });
  store.set('myStats', state.myStats);
  sync.soon();
  resultView();
}

// ---------- mock exam time limit ----------
// The countdown runs from the start time, so it keeps going while the app is in the background.

let examClock = null;

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function startExamClock(s) {
  clearInterval(examClock);
  examClock = setInterval(() => tickExam(s), 1000);
}

function tickExam(s) {
  if (state.session !== s || state.view !== 'exam') {
    if (state.session !== s) clearInterval(examClock);
    return;
  }
  const left = s.deadline - Date.now();
  if (left <= 0) {
    s.timedOut = true;
    submitExam(s);
    return;
  }
  const warn = left <= EXAM_WARN_MINUTES * 60000;
  if (warn && !s.warned) {
    s.warned = true;
    toast(t('exam.timeWarning', { minutes: EXAM_WARN_MINUTES }));
  }
  const clock = document.getElementById('exam-clock');
  if (clock) {
    clock.textContent = formatDuration(left);
    clock.classList.toggle('warn', warn);
  }
}

// A short message at the top of the screen that disappears by itself.
function toast(text) {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

// Hazard-perception questions link to their video on the Highway Bureau's file server.
function videoLink(q) {
  return q.videoUrl && h('a', { class: 'video-link', href: q.videoUrl, target: '_blank', rel: 'noopener' }, t('q.video'));
}

// "✗2 ✓5", with "?1" when some right answers were marked unsure.
function statLabel(r) {
  return '✗' + r.w + ' ✓' + r.c + (r.u ? ' ?' + r.u : '');
}

function questionView() {
  state.view = 'question';
  const s = state.session;
  const q = state.byId[s.ids[s.idx]];
  const r = allStats()[q.id];
  let answered = false;

  let lang = shownLang(q, state.settings.questionLang);
  let chosen = null;
  let unsure = false; // marked before answering; each question starts unmarked

  const feedback = h('div', { class: 'feedback' });
  const actions = h('div', { class: 'actions' });
  const stem = h('p', { class: 'qtext' });
  const labels = [0, 1, 2].map(() => h('span', {}));

  const choices = [0, 1, 2].map(i => ({ value: i }));
  const optionLabel = i => '(' + (i + 1) + ') ' + textFor(q, lang).options[i];

  const buttons = choices.map((ch, i) => h('button', { onclick: () => choose(ch.value) },
    labels[i],
    q.optionImages && h('img', { class: 'optimg', src: 'data/' + q.optionImages[i], alt: t('q.option', { n: i + 1 }) })));

  const unsureButton = h('button', {
    class: 'unsure-toggle',
    'aria-pressed': 'false',
    onclick: () => {
      unsure = !unsure;
      unsureButton.classList.toggle('on', unsure);
      unsureButton.setAttribute('aria-pressed', String(unsure));
    },
  }, t('q.unsure'));

  // Switch this question between languages; the choice becomes the default for the next question.
  const langs = enabledLangs();
  const toggle = langs.length > 1 && h('div', { class: 'lang-toggle', role: 'group', 'aria-label': t('q.languageGroup') },
    langs.map(code => {
      const available = !!textFor(q, code);
      return h('button', {
        'data-lang': code,
        disabled: !available,
        title: available ? '' : t('q.notAvailable', { language: langName(code) }),
        onclick: () => {
          state.settings.questionLang = code;
          prefsChanged();
          showText(code);
        },
      }, langLabel(code));
    }));

  function showText(code) {
    lang = shownLang(q, code);
    stem.textContent = textFor(q, lang).q;
    stem.lang = lang;
    labels.forEach((el, i) => { el.textContent = optionLabel(i); el.lang = lang; });
    if (toggle) toggle.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
    if (chosen !== null) showFeedback();
  }

  function showFeedback() {
    const correct = chosen === q.answer;
    feedback.className = 'feedback ' + (correct ? 'good' : 'bad');
    feedback.replaceChildren(liveText(correct ? t(unsure ? 'q.correctUnsure' : 'q.correct') : t('q.wrong', { answer: optionLabel(q.answer) })));
  }

  function choose(value) {
    if (answered) return;
    const correct = value === q.answer;
    Core.recordAnswer(state.myStats, q.id, correct, Date.now(), unsure);
    store.set('myStats', state.myStats);
    sync.soon();
    s.results.push({ id: q.id, correct });
    showAnswer(value);
  }

  function showAnswer(value) {
    answered = true;
    chosen = value;
    unsureButton.disabled = true;
    choices.forEach((ch, i) => {
      buttons[i].disabled = true;
      if (ch.value === q.answer) buttons[i].classList.add('correct');
      else if (ch.value === value) buttons[i].classList.add('wrong');
    });
    showFeedback();
    actions.append(h('button', { class: 'btn primary', onclick: next }, t(s.idx + 1 < s.ids.length ? 'q.next' : 'q.finish')));
  }

  function next() {
    s.idx++;
    if (s.idx < s.ids.length) questionView();
    else resultView();
  }

  showText(lang);
  render(h('div', { class: 'card' },
    h('div', { class: 'qmeta' },
      h('span', {}, (s.idx + 1) + ' / ' + s.ids.length),
      toggle,
      h('span', {}, r ? statLabel(r) : t('q.new'))),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, questionLabel(q)),
    (q.images || []).map(src => h('img', { class: 'qimg', src: 'data/' + src, alt: t('q.illustration') })),
    videoLink(q),
    stem,
    h('div', { class: 'options' + (q.optionImages ? ' pics' : '') }, buttons),
    h('div', { class: 'unsure-row' }, unsureButton),
    feedback,
    actions));
  setKeys([
    { keys: ['1', '2', '3'], show: '1–3', label: 'keys.answer', run: key => press(buttons[key - 1]) },
    { keys: ['/'], show: '/', label: 'keys.unsure', run: () => press(unsureButton) },
    languageKey(toggle),
    { keys: [' ', 'ArrowRight'], show: 'Space', label: 'keys.next', run: () => press(actions.querySelector('button')) },
    { keys: ['Escape'], show: 'Esc', label: 'keys.home', run: goHome },
  ]);
}

function resultView() {
  state.view = 'result';
  const s = state.session;
  clearInterval(examClock);
  const unanswered = s.ids.length - s.results.length;
  const right = s.results.filter(x => x.correct).length;
  const total = s.results.length;
  const wrongIds = s.results.filter(x => !x.correct).map(x => x.id);
  const score = right * EXAM.points;

  render(h('div', { class: 'card' },
    h('h2', {}, t(s.exam ? 'result.examTitle' : 'result.sessionTitle')),
    h('div', { class: 'result-score ' + (s.exam ? (score >= EXAM.pass ? 'pass' : 'fail') : '') }, s.exam ? score : right + ' / ' + total),
    s.exam && h('p', { style: 'text-align:center' }, score >= EXAM.pass ? t('result.pass') : t('result.fail', { pass: EXAM.pass })),
    s.timedOut && h('p', { class: 'muted', style: 'text-align:center' }, t('result.timeUp', { count: unanswered })),
    s.deadline && !s.timedOut && h('p', { class: 'muted', style: 'text-align:center' }, t('result.timeTaken', { time: formatDuration(s.finished - s.started) })),
    wrongIds.length > 0 && h('table', { class: 'weak' }, wrongIds.map(id => {
      const q = state.byId[id];
      const text = qText(q);
      return h('tr', {}, h('td', {},
        h('div', { class: 'muted' }, questionLabel(q)),
        (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })),
        text.q,
        h('div', { class: 'muted' }, t('result.answer', { answer: '(' + (q.answer + 1) + ') ' + text.options[q.answer] })),
        videoLink(q),
        q.optionImages && h('img', { class: 'thumb', src: 'data/' + q.optionImages[q.answer], alt: t('result.correctOption') })));
    })),
    h('div', { class: 'actions' },
      wrongIds.length > 0 && h('button', { class: 'btn', onclick: () => startSession(Core.shuffle(wrongIds, Math.random), 'retry', false) }, t('result.retry')),
      h('button', { class: 'btn primary', onclick: homeView }, t('result.home')))));
  const retry = wrongIds.length > 0 && view.querySelector('.actions .btn:not(.primary)');
  setKeys([
    { keys: ['Enter', 'Escape'], show: 'Enter', label: 'keys.home', run: goHome },
    { keys: ['r'], show: 'R', label: 'keys.retry', when: () => !!retry, run: () => press(retry) },
  ]);
}

// Fine-grained tokens are "github_pat_" + 82 characters, classic ones "ghp_" + 36. Only used as a hint after a failed sync.
function tokenProblem(token) {
  if (!token) return '';
  if (/^github_pat_\w{82}$/.test(token) || /^ghp_[A-Za-z0-9]{36}$/.test(token)) return '';
  if (/^(github_pat_|ghp_)/.test(token)) return t('gist.tokenLength', { length: token.length, expected: token.startsWith('ghp_') ? 40 : 93 });
  return t('gist.tokenFormat');
}

function settingsView() {
  state.view = 'settings';
  const mode = state.settings.syncMode;
  const status = h('p', { class: 'muted', id: 'sync-status' }, sync.lastMessage || '');
  // Sync, then redraw so the status and device list reflect the result.
  const syncNow = async () => {
    status.replaceChildren(liveText(t('sync.syncing')));
    await sync.run();
    if (state.view === 'settings') settingsView();
  };
  const name = h('input', {
    type: 'text', id: 'dname', value: state.settings.deviceName, maxlength: 40,
    onchange: e => { state.settings.deviceName = e.target.value.trim() || state.settings.deviceName; saveSettings(); sync.soon(); },
  });
  const devices = Object.entries(state.remoteDoc.devices || {});

  const modeSelect = h('select', {
    id: 'sync-mode',
    onchange: e => {
      if (state.settings.syncMode === 'code' && state.settings.syncCode && e.target.value !== 'code'
        && !confirm(t('settings.stopCode', { code: formatCode(state.settings.syncCode) }))) {
        e.target.value = state.settings.syncMode;
        return;
      }
      sync.configure({ syncMode: e.target.value });
      settingsView();
    },
  },
  h('option', { value: '', selected: !mode }, t('settings.syncOff')),
  h('option', { value: 'code', selected: mode === 'code' }, t('settings.syncCode')),
  (state.config.gistSync || mode === 'gist') && h('option', { value: 'gist', selected: mode === 'gist' }, t('settings.syncGist')));

  render(
    h('div', { class: 'card' },
      h('h2', {}, t('settings.syncTitle')),
      h('label', { for: 'sync-mode' }, t('settings.syncMethod')), modeSelect,
      mode === 'code' && codeSettings(status, syncNow),
      mode === 'gist' && gistSettings(),
      mode && [h('label', { for: 'dname' }, t('settings.deviceName')), name],
      mode && status,
      mode && devices.length > 0 && h('p', { class: 'muted' }, t('settings.devices', {
        list: live(() => devices.map(([id, d]) => tr('settings.deviceEntry', {
          name: d.name || id,
          self: id === state.deviceId ? t('settings.thisDevice') : '',
          count: Object.keys(d.stats || {}).length,
        })).join(', ')),
      }))),
    available(PRIMARY_LANG) && h('div', { class: 'card' },
      h('h2', {}, t('settings.questionLanguages')),
      h('p', { class: 'muted' }, t('settings.questionLanguagesHelp')),
      h('label', { for: 'second-lang' }, t('settings.secondLanguage')),
      h('select', {
        id: 'second-lang',
        onchange: async e => {
          const code = e.target.value;
          if (!(await loadText(code))) {
            alert(t('settings.downloadFailed', { language: langName(code) }));
            e.target.value = secondLang();
            return;
          }
          if (state.settings.questionLang === secondLang()) state.settings.questionLang = code;
          state.settings.secondLang = code;
          prefsChanged();
        },
      }, state.languages.filter(l => l.code !== PRIMARY_LANG).map(l =>
        h('option', { value: l.code, selected: l.code === secondLang() }, langName(l.code))))),
    h('div', { class: 'card' },
      h('h2', {}, t('settings.exam')),
      h('label', { for: 'exam-time' }, t('settings.examTime')),
      h('select', {
        id: 'exam-time',
        onchange: e => { state.settings.examMinutes = +e.target.value; saveSettings(); },
      }, EXAM_TIME_LIMITS.map(n => h('option', { value: n, selected: n === state.settings.examMinutes },
        n === 0 ? t('settings.examTimeOff')
          : t(n === OFFICIAL_EXAM_MINUTES ? 'settings.examTimeOfficial' : 'settings.examTimeMinutes', { n })))),
      h('p', { class: 'muted' }, t('settings.examTimeHelp', { minutes: OFFICIAL_EXAM_MINUTES }))),
    h('div', { class: 'card' },
      h('h2', {}, t('settings.data')),
      h('p', { class: 'muted' }, t('settings.dataHelpBefore', { count: state.questions.length }),
        h('a', { href: 'https://www.thb.gov.tw/News_Download.aspx?n=284&sms=12823', target: '_blank', rel: 'noopener' }, t('settings.dataHelpLink')),
        t('settings.dataHelpAfter')),
      h('table', { class: 'editions' }, [...state.languages].sort((a, b) => (b.code === PRIMARY_LANG) - (a.code === PRIMARY_LANG)).map(l => h('tr', {},
        h('th', {}, langName(l.code)),
        h('td', {}, l.edition || t('settings.unknownEdition'), l.date && h('div', { class: 'muted' }, l.date)),
        h('td', { class: 'muted' }, t('settings.questionCount', { count: l.questions || 0 }))))),
      state.hazard && h('p', { class: 'muted' }, t('settings.hazardEdition', { edition: state.hazard.edition, count: state.hazard.questions.length })),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn',
          onclick: () => {
            if (!confirm(t('settings.resetConfirm'))) return;
            state.myStats = {};
            store.set('myStats', {});
            sync.run();
            homeView();
          },
        }, t('settings.reset')))),
    h('div', { class: 'card' },
      h('h2', {}, t('settings.support')),
      h('p', { class: 'muted' }, t('settings.supportHelp')),
      h('a', { class: 'btn link-btn', href: SUPPORT_URL, target: '_blank', rel: 'noopener' }, t('settings.getSupport')),
      versionLine()));
  setKeys([{ keys: ['Escape'], show: 'Esc', label: 'keys.home', run: goHome }]);
}

function codeSettings(status, syncNow) {
  const code = state.settings.syncCode;
  if (code) {
    const pretty = formatCode(code);
    const shareText = t('code.share', { code: pretty, url: location.origin + location.pathname });
    return h('div', {},
      h('p', { class: 'muted' }, t('code.help')),
      h('div', { class: 'sync-code', id: 'sync-code' }, pretty),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn',
          onclick: async e => {
            try { await navigator.clipboard.writeText(pretty); e.target.replaceChildren(liveText(t('code.copied'))); } catch (err) { /* clipboard unavailable */ }
          },
        }, t('code.copy')),
        navigator.share && h('button', {
          class: 'btn',
          onclick: () => navigator.share({ text: String(shareText) }).catch(() => {}),
        }, t('code.shareButton')),
        h('button', { class: 'btn primary', onclick: syncNow }, t('code.syncNow'))));
  }
  const input = h('input', {
    type: 'text', id: 'code-input', placeholder: 'XXXX-XXXX-XXXX', class: 'mono',
    autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
  });
  return h('div', {},
    h('p', { class: 'muted' }, t('code.intro')),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          sync.configure({ syncCode: newSyncCode() });
          await syncNow();
        },
      }, t('code.create'))),
    h('label', { for: 'code-input' }, t('code.existing')),
    input,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const value = normaliseCode(input.value);
          if (!value) { status.replaceChildren(liveText(t('code.invalid'))); return; }
          sync.configure({ syncCode: value });
          await syncNow();
        },
      }, t('code.link'))));
}

function gistSettings() {
  // A plain text field so browsers do not offer to autofill a saved password, and the pasted token can be checked by eye.
  const token = h('input', {
    type: 'text', id: 'token', value: state.settings.token, placeholder: 'github_pat_…',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: 'mono',
  });
  return h('div', {},
    h('p', { class: 'muted' }, t('gist.help')),
    h('label', { for: 'token' }, t('gist.token')), token,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const value = token.value.replace(/\s+/g, '');
          if (value !== state.settings.token) sync.configure({ token: value, gistId: '' });
          await sync.run();
          const problem = tokenProblem(value);
          if (problem && sync.lastKind === 'err') {
            const failure = sync.lastMessage;
            sync.lastMessage = live(() => failure + ' ' + problem);
          }
          if (state.view === 'settings') settingsView();
        },
      }, t('gist.save'))));
}

document.querySelectorAll('.nav[data-view]').forEach(b => b.addEventListener('click', () => {
  state.session = null;
  (b.dataset.view === 'settings' ? settingsView : homeView)();
}));

// "Version v2.0.0" for a release, linking to its release notes; "Version v2.0.0+3 (1a2b3c4)"
// after one, linking to the commit; " · QA" on QA; "Version dev" locally.
function versionLine() {
  const { version, commit, environment } = state.version;
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const release = commit && /^v\d+(\.\d+)*$/.test(version || '');
  const commitLink = commit && ext(REPO_URL + '/commit/' + commit, commit.slice(0, 7));
  return h('p', { class: 'muted' }, t('settings.version'), ' ',
    release ? ext(REPO_URL + '/releases/tag/' + version, version)
      : version && commitLink ? [version, ' (', commitLink, ')'] : version || commitLink,
    environment === 'qa' && ' · QA');
}

// ---------- boot ----------

async function loadConfig() {
  try {
    const res = await fetch('api/config', { cache: 'no-store' });
    if (!res.ok) return;
    state.config = await res.json();
    store.set('config', state.config);
  } catch (e) { /* offline: keep the last known config */ }
}

async function loadVersion() {
  try {
    const res = await fetch('version.json');
    if (res.ok) state.version = await res.json();
  } catch (e) { /* offline without cache */ }
}

async function boot() {
  updateKeyboardClass();
  await Promise.all([setUiLang(preferredUiLang()), loadConfig(), loadVersion()]);
  if (!state.settings.deviceName) {
    state.settings.deviceName = defaultDeviceName();
    saveSettings();
  }
  try {
    const res = await fetch('data/bank.json');
    if (res.ok) {
      const bank = await res.json();
      state.questions = bank.questions || [];
      state.languages = bank.languages || [];
    }
  } catch (e) { /* offline without cache, or missing file */ }
  if (state.questions.length) await loadHazard();
  if (!(await loadText(REFERENCE_LANG))) state.questions = [];
  await Promise.all(enabledLangs().map(loadText));
  if (!enabledLangs().includes(state.settings.questionLang)) state.settings.questionLang = REFERENCE_LANG;
  state.questions.forEach(q => { state.byId[q.id] = q; });
  if (!state.questions.some(q => q.section === state.settings.section)) state.settings.section = '';
  if (!state.questions.some(q => q.topic === state.settings.topic)) state.settings.topic = '';
  homeView();
  sync.run();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
