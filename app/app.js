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
  settings: Object.assign({ token: '', gistId: '', deviceName: '', section: '', topic: '', length: 20 }, store.get('settings', {})),
  session: null,
};

if (!state.deviceId) {
  state.deviceId = Math.random().toString(36).slice(2, 10);
  store.set('deviceId', state.deviceId);
}
if (!state.settings.deviceName) {
  state.settings.deviceName = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))
    ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Browser';
}

function saveSettings() { store.set('settings', state.settings); }

function allStats() {
  const devices = Object.assign({}, state.remoteDoc.devices);
  devices[state.deviceId] = { stats: state.myStats };
  return Core.mergeDevices(devices);
}

function pool() {
  const { section, topic } = state.settings;
  return state.questions.filter(q => (!section || q.section === section) && (!topic || q.topic === topic));
}

// ---------- sync via a private GitHub Gist ----------

const sync = {
  timer: null,
  busy: false,
  status(kind, msg) {
    const dot = document.getElementById('sync-dot');
    dot.className = 'sync-dot ' + (kind || '');
    dot.title = msg || '';
    sync.lastMessage = msg || '';
  },
  async api(path, opts) {
    const res = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + state.settings.token,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }));
    if (!res.ok) throw new Error('GitHub ' + res.status + ' ' + (await res.text()).slice(0, 120));
    return res.json();
  },
  async findOrCreateGist() {
    if (state.settings.gistId) return state.settings.gistId;
    for (let page = 1; page <= 10; page++) {
      const gists = await sync.api('/gists?per_page=100&page=' + page);
      const hit = gists.find(g => g.files && g.files[STATS_FILE]);
      if (hit) { state.settings.gistId = hit.id; saveSettings(); return hit.id; }
      if (gists.length < 100) break;
    }
    const created = await sync.api('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Taiwan car written exam practice stats',
        public: false,
        files: { [STATS_FILE]: { content: JSON.stringify({ version: 1, devices: {} }) } },
      }),
    });
    state.settings.gistId = created.id;
    saveSettings();
    return created.id;
  },
  async run() {
    if (!state.settings.token || sync.busy || !navigator.onLine) return;
    sync.busy = true;
    sync.status('busy', 'Syncing…');
    try {
      const id = await sync.findOrCreateGist();
      const gist = await sync.api('/gists/' + id);
      const file = gist.files[STATS_FILE];
      let text = file ? file.content : '';
      if (file && file.truncated) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
      let doc;
      try { doc = JSON.parse(text); } catch (e) { doc = null; }
      if (!doc || typeof doc.devices !== 'object') doc = { version: 1, devices: {} };
      // Each device owns only its own entry, so concurrent devices never overwrite each other's answers.
      doc.devices[state.deviceId] = { name: state.settings.deviceName, updated: Date.now(), stats: state.myStats };
      await sync.api('/gists/' + id, {
        method: 'PATCH',
        body: JSON.stringify({ files: { [STATS_FILE]: { content: JSON.stringify(doc) } } }),
      });
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
  return '#' + q.no + (q.also ? ' (also #' + q.also.join(', #') + ')' : '') + (q.topic ? ' · ' + q.topic.replace(/\s*\(.*\)$/, '') : '');
}

// ---------- views ----------

function homeView() {
  state.view = 'home';
  if (!state.questions.length) {
    return render(h('div', { class: 'card' },
      h('h2', {}, 'No question bank loaded'),
      h('p', {}, 'app/data/questions.json is missing or empty. Run tools/extract_questions.py on the official PDF (see README).')));
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
      sections.map(c => h('option', { value: c, selected: c === state.settings.section }, c))),
      h('label', { for: 'topic' }, 'Topic'),
      h('select', {
        id: 'topic',
        onchange: e => { state.settings.topic = e.target.value; saveSettings(); homeView(); },
      }, h('option', { value: '' }, 'All topics'),
      topics.map(c => h('option', { value: c, selected: c === state.settings.topic }, c))),
      h('p', { class: 'muted' }, 'Section and topic apply to practice modes; the mock exam always uses the whole bank.')),
    !state.settings.token && h('div', { class: 'card' },
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
            (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })), q.q),
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

  const feedback = h('div', { class: 'feedback' });
  const actions = h('div', { class: 'actions' });

  const choices = q.options.map((o, i) => ({ label: '(' + (i + 1) + ') ' + o, value: i }));

  const buttons = choices.map((ch, i) => h('button', { onclick: () => choose(ch.value) },
    ch.label,
    q.optionImages && h('img', { class: 'optimg', src: 'data/' + q.optionImages[i], alt: 'Option ' + (i + 1) })));

  function choose(value) {
    if (answered) return;
    answered = true;
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
    feedback.className = 'feedback ' + (correct ? 'good' : 'bad');
    feedback.textContent = correct ? '✓ Correct' : '✗ Wrong: answer is ' + choices.find(c => c.value === q.answer).label;
    actions.append(h('button', { class: 'btn primary', onclick: next }, s.idx + 1 < s.ids.length ? 'Next →' : 'Finish'));
  }

  function next() {
    s.idx++;
    if (s.idx < s.ids.length) questionView();
    else resultView();
  }

  render(h('div', { class: 'card' },
    h('div', { class: 'qmeta' },
      h('span', {}, (s.idx + 1) + ' / ' + s.ids.length),
      h('span', {}, r ? '✗' + r.w + ' ✓' + r.c : 'new')),
    h('div', { class: 'muted', style: 'margin-bottom:6px' }, questionLabel(q)),
    (q.images || []).map(src => h('img', { class: 'qimg', src: 'data/' + src, alt: 'Question illustration' })),
    h('p', { class: 'qtext' }, q.q),
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
      return h('tr', {}, h('td', {},
        h('div', { class: 'muted' }, questionLabel(q)),
        (q.images || []).map(src => h('img', { class: 'thumb', src: 'data/' + src, alt: '' })),
        q.q,
        h('div', { class: 'muted' }, 'Answer: (' + (q.answer + 1) + ') ' + q.options[q.answer]),
        q.optionImages && h('img', { class: 'thumb', src: 'data/' + q.optionImages[q.answer], alt: 'Correct option' })));
    })),
    h('div', { class: 'actions' },
      wrongIds.length > 0 && h('button', { class: 'btn', onclick: () => startSession(Core.shuffle(wrongIds, Math.random), 'retry', false) }, 'Retry mistakes'),
      h('button', { class: 'btn primary', onclick: homeView }, 'Home'))));
}

function settingsView() {
  state.view = 'settings';
  const devices = Object.entries(state.remoteDoc.devices || {});
  const token = h('input', { type: 'password', id: 'token', value: state.settings.token, autocomplete: 'off', placeholder: 'github_pat_…' });
  const name = h('input', { type: 'text', id: 'dname', value: state.settings.deviceName });
  const status = h('p', { class: 'muted' }, sync.lastMessage || '');

  render(
    h('div', { class: 'card' },
      h('h2', {}, 'Sync between devices'),
      h('p', { class: 'muted' },
        'Stats are stored in a private GitHub Gist. Create a fine-grained token at github.com/settings/personal-access-tokens with only "Gists: Read and write" permission, and paste the same token on each device.'),
      h('label', { for: 'token' }, 'GitHub token'), token,
      h('label', { for: 'dname' }, 'This device name'), name,
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            const changed = token.value.trim() !== state.settings.token;
            state.settings.token = token.value.trim();
            state.settings.deviceName = name.value.trim() || state.settings.deviceName;
            if (changed) state.settings.gistId = '';
            saveSettings();
            status.textContent = 'Syncing…';
            await sync.run();
            status.textContent = sync.lastMessage;
          },
        }, 'Save & sync now')),
      status,
      devices.length > 0 && h('p', { class: 'muted' }, 'Devices: ' + devices.map(([id, d]) =>
        (d.name || id) + (id === state.deviceId ? ' (this)' : '') + ' – ' + Object.keys(d.stats || {}).length + ' answered').join(', '))),
    h('div', { class: 'card' },
      h('h2', {}, 'Data'),
      h('p', { class: 'muted' }, state.questions.length + ' questions loaded.'),
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

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => {
  state.session = null;
  (b.dataset.view === 'settings' ? settingsView : homeView)();
}));

// ---------- boot ----------

async function boot() {
  try {
    const res = await fetch('data/questions.json');
    if (res.ok) state.questions = (await res.json()).questions || [];
  } catch (e) { /* offline without cache, or missing file */ }
  state.questions.forEach(q => { state.byId[q.id] = q; });
  if (!state.questions.some(q => q.section === state.settings.section)) state.settings.section = '';
  if (!state.questions.some(q => q.topic === state.settings.topic)) state.settings.topic = '';
  homeView();
  sync.run();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
