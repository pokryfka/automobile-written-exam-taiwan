/* global Core */
'use strict';

const STATS_FILE = 'taiwan-car-exam-stats.json';
const EXAM_SIZE = 40;
const EXAM_PASS = 85;
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
  languages: [], // [{ code, name }] from bank.json; the first is the reference (English)
  text: {}, // language code -> { sections, topics, questions: { [id]: { q, options } } }
  settings: Object.assign({
    syncMode: '', syncCode: '', token: '', gistId: '', deviceName: '', section: '', topic: '', length: 20,
    secondLang: 'en', // language offered next to Chinese on each question
    questionLang: 'en', // language the next question opens in
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
if (!state.settings.deviceName) {
  state.settings.deviceName = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))
    ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Browser';
}

function saveSettings() { store.set('settings', state.settings); }

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
// is always loaded: the interface uses its section and topic names, and it is the fallback
// for questions missing in the other languages.

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

function langLabel(code) {
  if (code === REFERENCE_LANG) return 'EN';
  const l = state.languages.find(x => x.code === code);
  return l ? l.name : code;
}

// Section and topic names follow the interface, which is English only.
function sectionName(key) {
  const t = state.text[REFERENCE_LANG];
  return (t && t.sections[key]) || key;
}

function topicName(key) {
  const t = state.text[REFERENCE_LANG];
  return (t && t.topics[key]) || key;
}

async function loadText(code) {
  if (state.text[code]) return true;
  try {
    const res = await fetch('data/text/' + code + '.json');
    if (!res.ok) return false;
    state.text[code] = await res.json();
    return true;
  } catch (e) {
    return false; // offline and not cached yet
  }
}

function pool() {
  const { section, topic } = state.settings;
  return state.questions.filter(q => (!section || q.section === section) && (!topic || q.topic === topic));
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
      const hint = {
        401: 'GitHub does not recognise this token. Check it was copied completely, or create a new one.',
        403: 'The token is missing the "Gists: Read and write" permission.',
        404: 'The token is missing the "Gists: Read and write" permission, or the gist was deleted.',
      }[res.status];
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
      body: JSON.stringify({ name: entry.name, stats: entry.stats }),
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
  status(kind, msg) {
    const dot = document.getElementById('sync-dot');
    dot.className = 'sync-dot ' + (kind || '');
    dot.title = msg || '';
    sync.lastMessage = msg || '';
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
    sync.status('busy', 'Syncing…');
    try {
      const entry = { name: state.settings.deviceName, updated: Date.now(), stats: state.myStats };
      const doc = await backend.push(entry);
      if (backend !== sync.backend()) return; // settings changed while syncing
      state.remoteDoc = doc;
      store.set('remoteDoc', doc);
      store.set('lastSync', Date.now());
      sync.status('ok', 'Synced ' + new Date().toLocaleTimeString());
      if (state.view === 'home') homeView();
    } catch (e) {
      sync.status('err', 'Sync failed: ' + e.message);
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
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function render(...nodes) {
  view.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function questionLabel(q) {
  return '#' + q.no + (q.also ? ' (also #' + q.also.join(', #') + ')' : '') + (q.topic ? ' · ' + topicName(q.topic).replace(/\s*\(.*\)$/, '') : '');
}

// ---------- views ----------

function homeView() {
  state.view = 'home';
  if (!state.questions.length) {
    return render(h('div', { class: 'card' },
      h('h2', {}, 'No question bank loaded'),
      h('p', {}, 'app/data/bank.json is missing or empty. Run tools/extract_questions.py on the official PDF (see README).')));
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
      alert(mode === 'weak' ? 'No failed questions yet, nice!' : 'Nothing left in this mode.');
      return;
    }
    startSession(picked.map(q => q.id), mode, false);
  };

  render(
    h('div', { class: 'card' },
      h('div', { class: 'stats-row' },
        h('div', {}, h('b', {}, s.seen), h('span', {}, 'seen / ' + s.total)),
        h('div', {}, h('b', {}, s.mastered), h('span', {}, 'mastered')),
        h('div', {}, h('b', {}, s.weak), h('span', {}, 'to review')),
        h('div', {}, h('b', {}, accuracy), h('span', {}, 'accuracy'))),
      h('div', { class: 'progress' }, h('div', { style: 'width:' + pct + '%' })),
      h('p', { class: 'muted' }, pct + '% mastered (last 3 answers correct)')),
    h('div', { class: 'card' },
      h('h2', {}, 'Practice'),
      h('div', { class: 'modes' },
        h('button', { onclick: start('smart') }, h('b', {}, '🎯 Smart'), h('small', {}, 'Weak + new mixed')),
        h('button', { onclick: start('weak') }, h('b', {}, '🔥 Mistakes'), h('small', {}, 'Most failed first')),
        h('button', { onclick: start('unseen') }, h('b', {}, '🆕 New'), h('small', {}, 'Never answered')),
        h('button', { onclick: start('random') }, h('b', {}, '🎲 Random'), h('small', {}, 'Any question')),
        h('button', {
          onclick: () => startSession(Core.pickExam(state.questions, EXAM_SIZE).map(q => q.id), 'exam', true),
        }, h('b', {}, '📝 Mock exam'), h('small', {}, EXAM_SIZE + ' questions, pass ' + EXAM_PASS)),
        h('button', { onclick: weakListView }, h('b', {}, '📊 Weak list'), h('small', {}, 'Your top mistakes'))),
      h('label', { for: 'len' }, 'Questions per session'),
      h('select', {
        id: 'len',
        onchange: e => { state.settings.length = +e.target.value; saveSettings(); },
      }, [10, 20, 40, 80].map(n => h('option', { value: n, selected: n === len }, n))),
      h('label', { for: 'section' }, 'Section'),
      h('select', {
        id: 'section',
        onchange: e => { state.settings.section = e.target.value; state.settings.topic = ''; saveSettings(); homeView(); },
      }, h('option', { value: '' }, 'All sections'),
      sections.map(c => h('option', { value: c, selected: c === state.settings.section }, sectionName(c)))),
      h('label', { for: 'topic' }, 'Topic'),
      h('select', {
        id: 'topic',
        onchange: e => { state.settings.topic = e.target.value; saveSettings(); homeView(); },
      }, h('option', { value: '' }, 'All topics'),
      topics.map(c => h('option', { value: c, selected: c === state.settings.topic }, topicName(c)))),
      h('p', { class: 'muted' }, 'Section and topic apply to practice modes; the mock exam always uses the whole bank.')),
    !sync.backend() && h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'Stats are only on this device. Set up sync in ⚙️ to share them between iPhone and iPad.')),
  );
}

function weakListView() {
  state.view = 'weak';
  const stats = allStats();
  const rows = pool()
    .filter(q => stats[q.id] && stats[q.id].w > 0)
    .map(q => ({ q, r: stats[q.id], score: Core.weakness(stats[q.id]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  render(h('div', { class: 'card' },
    h('h2', {}, 'Most failed questions'),
    rows.length
      ? [
        h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:10px', onclick: () => startSession(rows.slice(0, state.settings.length).map(x => x.q.id), 'weak', false) }, 'Practice these'),
        h('table', { class: 'weak' }, rows.map(({ q, r }) => h('tr', {},
          h('td', {}, h('div', { class: 'muted' }, questionLabel(q)),
            (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })), qText(q).q),
          h('td', { class: 'num' }, '✗' + r.w + ' ✓' + r.c)))),
      ]
      : h('p', { class: 'muted' }, 'No mistakes recorded yet.')));
}

function startSession(ids, mode, exam) {
  state.session = { ids, idx: 0, mode, exam, results: [] };
  questionView();
}

function questionView() {
  state.view = 'question';
  const s = state.session;
  const q = state.byId[s.ids[s.idx]];
  const r = allStats()[q.id];
  let answered = false;

  let lang = shownLang(q, state.settings.questionLang);
  let chosen = null;

  const feedback = h('div', { class: 'feedback' });
  const actions = h('div', { class: 'actions' });
  const stem = h('p', { class: 'qtext' });
  const labels = [0, 1, 2].map(() => h('span', {}));

  const choices = [0, 1, 2].map(i => ({ value: i }));
  const optionLabel = i => '(' + (i + 1) + ') ' + textFor(q, lang).options[i];

  const buttons = choices.map((ch, i) => h('button', { onclick: () => choose(ch.value) },
    labels[i],
    q.optionImages && h('img', { class: 'optimg', src: 'data/' + q.optionImages[i], alt: 'Option ' + (i + 1) })));

  // Switch this question between languages; the choice becomes the default for the next question.
  const langs = enabledLangs();
  const toggle = langs.length > 1 && h('div', { class: 'lang-toggle', role: 'group', 'aria-label': 'Question language' },
    langs.map(code => {
      const available = !!textFor(q, code);
      return h('button', {
        'data-lang': code,
        disabled: !available,
        title: available ? '' : 'This question is not available in ' + langLabel(code),
        onclick: () => {
          state.settings.questionLang = code;
          saveSettings();
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
    feedback.textContent = correct ? '✓ Correct' : '✗ Wrong: answer is ' + optionLabel(q.answer);
  }

  function choose(value) {
    if (answered) return;
    answered = true;
    chosen = value;
    const correct = value === q.answer;
    Core.recordAnswer(state.myStats, q.id, correct, Date.now());
    store.set('myStats', state.myStats);
    sync.soon();
    s.results.push({ id: q.id, correct });

    if (s.exam) return next();

    choices.forEach((ch, i) => {
      buttons[i].disabled = true;
      if (ch.value === q.answer) buttons[i].classList.add('correct');
      else if (ch.value === value) buttons[i].classList.add('wrong');
    });
    showFeedback();
    actions.append(h('button', { class: 'btn primary', onclick: next }, s.idx + 1 < s.ids.length ? 'Next →' : 'Finish'));
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
      h('span', {}, r ? '✗' + r.w + ' ✓' + r.c : 'new')),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, questionLabel(q)),
    (q.images || []).map(src => h('img', { class: 'qimg', src: 'data/' + src, alt: 'Question illustration' })),
    stem,
    h('div', { class: 'options' + (q.optionImages ? ' pics' : '') }, buttons),
    feedback,
    actions));
}

function resultView() {
  state.view = 'result';
  const s = state.session;
  const right = s.results.filter(x => x.correct).length;
  const total = s.results.length;
  const wrongIds = s.results.filter(x => !x.correct).map(x => x.id);
  const score = total ? Math.round((right / total) * 1000) / 10 : 0;

  render(h('div', { class: 'card' },
    h('h2', {}, s.exam ? 'Mock exam result' : 'Session done'),
    h('div', { class: 'result-score ' + (s.exam ? (score >= EXAM_PASS ? 'pass' : 'fail') : '') }, s.exam ? score : right + ' / ' + total),
    s.exam && h('p', { style: 'text-align:center' }, score >= EXAM_PASS ? 'Pass 🎉' : 'Below ' + EXAM_PASS + ', keep practising'),
    wrongIds.length > 0 && h('table', { class: 'weak' }, wrongIds.map(id => {
      const q = state.byId[id];
      const t = qText(q);
      return h('tr', {}, h('td', {},
        h('div', { class: 'muted' }, questionLabel(q)),
        (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })),
        t.q,
        h('div', { class: 'muted' }, 'Answer: (' + (q.answer + 1) + ') ' + t.options[q.answer]),
        q.optionImages && h('img', { class: 'thumb', src: 'data/' + q.optionImages[q.answer], alt: 'Correct option' })));
    })),
    h('div', { class: 'actions' },
      wrongIds.length > 0 && h('button', { class: 'btn', onclick: () => startSession(Core.shuffle(wrongIds, Math.random), 'retry', false) }, 'Retry mistakes'),
      h('button', { class: 'btn primary', onclick: homeView }, 'Home'))));
}

// Fine-grained tokens are "github_pat_" + 82 characters, classic ones "ghp_" + 36. Only used as a hint after a failed sync.
function tokenProblem(t) {
  if (!t) return '';
  if (/^github_pat_\w{82}$/.test(t) || /^ghp_[A-Za-z0-9]{36}$/.test(t)) return '';
  if (/^(github_pat_|ghp_)/.test(t)) return 'This token has ' + t.length + ' characters, expected ' + (t.startsWith('ghp_') ? 40 : 93) + '. It was probably not copied completely.';
  return 'This does not look like a GitHub token. It should start with "github_pat_".';
}

function settingsView() {
  state.view = 'settings';
  const mode = state.settings.syncMode;
  const status = h('p', { class: 'muted', id: 'sync-status' }, sync.lastMessage || '');
  // Sync, then redraw so the status and device list reflect the result.
  const syncNow = async () => {
    status.textContent = 'Syncing…';
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
        && !confirm('Stop using sync code ' + formatCode(state.settings.syncCode) + ' on this device? Write it down if you want to link again later.')) {
        e.target.value = state.settings.syncMode;
        return;
      }
      sync.configure({ syncMode: e.target.value });
      settingsView();
    },
  },
  h('option', { value: '', selected: !mode }, 'Off: stats stay on this device'),
  h('option', { value: 'code', selected: mode === 'code' }, 'Sync code: no account needed'),
  h('option', { value: 'gist', selected: mode === 'gist' }, 'GitHub Gist: stored in your GitHub account'));

  render(
    h('div', { class: 'card' },
      h('h2', {}, 'Sync between devices'),
      h('label', { for: 'sync-mode' }, 'Sync method'), modeSelect,
      mode === 'code' && codeSettings(status, syncNow),
      mode === 'gist' && gistSettings(),
      mode && [h('label', { for: 'dname' }, 'This device name'), name],
      mode && status,
      mode && devices.length > 0 && h('p', { class: 'muted' }, 'Devices: ' + devices.map(([id, d]) =>
        (d.name || id) + (id === state.deviceId ? ' (this)' : '') + ' – ' + Object.keys(d.stats || {}).length + ' answered').join(', '))),
    available(PRIMARY_LANG) && h('div', { class: 'card' },
      h('h2', {}, 'Question languages'),
      h('p', { class: 'muted' }, 'Each question can be switched between 中文 and a second language. Both are downloaded for offline use.'),
      h('label', { for: 'second-lang' }, 'Second language'),
      h('select', {
        id: 'second-lang',
        onchange: async e => {
          const code = e.target.value;
          if (!(await loadText(code))) {
            alert('Could not download ' + langLabel(code) + '. Check your connection and try again.');
            e.target.value = secondLang();
            return;
          }
          if (state.settings.questionLang === secondLang()) state.settings.questionLang = code;
          state.settings.secondLang = code;
          saveSettings();
        },
      }, state.languages.filter(l => l.code !== PRIMARY_LANG).map(l =>
        h('option', { value: l.code, selected: l.code === secondLang() }, l.name)))),
    h('div', { class: 'card' },
      h('h2', {}, 'Data'),
      h('p', { class: 'muted' }, state.questions.length + ' questions in the bank. Each language comes from its own edition of the ',
        h('a', { href: 'https://www.thb.gov.tw/News_Download.aspx?n=284&sms=12823', target: '_blank', rel: 'noopener' }, 'Highway Bureau question bank'),
        ', and editions are not always updated at the same time.'),
      h('table', { class: 'editions' }, [...state.languages].sort((a, b) => (b.code === PRIMARY_LANG) - (a.code === PRIMARY_LANG)).map(l => h('tr', {},
        h('th', {}, l.name),
        h('td', {}, l.edition || 'unknown edition', l.date && h('div', { class: 'muted' }, l.date)),
        h('td', { class: 'muted' }, (l.questions || 0) + ' questions')))),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn',
          onclick: () => {
            if (!confirm('Reset the stats recorded on this device? Other devices keep theirs.')) return;
            state.myStats = {};
            store.set('myStats', {});
            sync.run();
            homeView();
          },
        }, 'Reset this device'))));
}

function codeSettings(status, syncNow) {
  const code = state.settings.syncCode;
  if (code) {
    const pretty = formatCode(code);
    const shareText = 'Car Exam sync code: ' + pretty + '\nOpen ' + location.origin + location.pathname + ' → ⚙️ → Sync code → Use an existing code.';
    return h('div', {},
      h('p', { class: 'muted' }, 'Enter this code on your other devices. Anyone with the code can see and change these stats, so keep it private.'),
      h('div', { class: 'sync-code', id: 'sync-code' }, pretty),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn',
          onclick: async e => {
            try { await navigator.clipboard.writeText(pretty); e.target.textContent = 'Copied'; } catch (err) { /* clipboard unavailable */ }
          },
        }, 'Copy'),
        navigator.share && h('button', {
          class: 'btn',
          onclick: () => navigator.share({ text: shareText }).catch(() => {}),
        }, 'Share'),
        h('button', { class: 'btn primary', onclick: syncNow }, 'Sync now')));
  }
  const input = h('input', {
    type: 'text', id: 'code-input', placeholder: 'XXXX-XXXX-XXXX', class: 'mono',
    autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
  });
  return h('div', {},
    h('p', { class: 'muted' }, 'First device: create a code. Other devices: enter the same code.'),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          sync.configure({ syncCode: newSyncCode() });
          await syncNow();
        },
      }, 'Create a new code')),
    h('label', { for: 'code-input' }, 'Use an existing code'),
    input,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const value = normaliseCode(input.value);
          if (!value) { status.textContent = 'That does not look like a sync code: it has 12 letters and digits, like ABCD-EFGH-JKMN.'; return; }
          sync.configure({ syncCode: value });
          await syncNow();
        },
      }, 'Link this device')));
}

function gistSettings() {
  // A plain text field so iOS does not offer to autofill a saved password, and the pasted token can be checked by eye.
  const token = h('input', {
    type: 'text', id: 'token', value: state.settings.token, placeholder: 'github_pat_…',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: 'mono',
  });
  return h('div', {},
    h('p', { class: 'muted' },
      'Stats are stored in a private GitHub Gist. Create a fine-grained token at github.com/settings/personal-access-tokens with only "Gists: Read and write" permission, and paste the same token on each device.'),
    h('label', { for: 'token' }, 'GitHub token'), token,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const value = token.value.replace(/\s+/g, '');
          if (value !== state.settings.token) sync.configure({ token: value, gistId: '' });
          await sync.run();
          const problem = tokenProblem(value);
          if (problem && /failed/.test(sync.lastMessage)) sync.lastMessage += ' ' + problem;
          if (state.view === 'settings') settingsView();
        },
      }, 'Save & sync now')));
}

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => {
  state.session = null;
  (b.dataset.view === 'settings' ? settingsView : homeView)();
}));

// ---------- boot ----------

async function boot() {
  try {
    const res = await fetch('data/bank.json');
    if (res.ok) {
      const bank = await res.json();
      state.questions = bank.questions || [];
      state.languages = bank.languages || [];
    }
  } catch (e) { /* offline without cache, or missing file */ }
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
