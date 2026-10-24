// Pure logic shared by the app and the Node tests: stats merging and question picking.
(function (root) {
  'use strict';

  // Per-question record kept by each device:
  //   c: times answered correctly, w: times answered wrong,
  //   h: last results, newest last ("1" right, "0" wrong), at most HISTORY chars,
  //   t: timestamp (ms) of the last answer.
  const HISTORY = 5;

  function emptyRecord() {
    return { c: 0, w: 0, h: '', t: 0 };
  }

  function recordAnswer(stats, qid, correct, now) {
    const r = stats[qid] || emptyRecord();
    if (correct) r.c++; else r.w++;
    r.h = (r.h + (correct ? '1' : '0')).slice(-HISTORY);
    r.t = now;
    stats[qid] = r;
    return r;
  }

  // Combine the per-device stats of a sync document into one view.
  // Counts are summed; the history comes from whichever device answered last.
  function mergeDevices(devices) {
    const out = {};
    for (const dev of Object.values(devices || {})) {
      for (const [qid, r] of Object.entries(dev.stats || {})) {
        const m = out[qid] || (out[qid] = emptyRecord());
        m.c += r.c || 0;
        m.w += r.w || 0;
        if ((r.t || 0) >= m.t) { m.t = r.t || 0; m.h = r.h || ''; }
      }
    }
    return out;
  }

  // How much a question needs practice, higher is weaker.
  // Laplace-smoothed error rate, boosted when the latest answers were wrong
  // and damped once it has been answered right several times in a row.
  function weakness(r) {
    if (!r || r.c + r.w === 0) return null;
    let score = (r.w + 1) / (r.c + r.w + 2);
    const last = r.h.slice(-1);
    if (last === '0') score += 0.5;
    const streak = r.h.length - r.h.lastIndexOf('0') - 1;
    if (streak >= 3) score *= 0.3;
    return score;
  }

  function isMastered(r) {
    return !!r && r.h.length >= 3 && r.h.slice(-3) === '111';
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Weighted sample without replacement (Efraimidis–Spirakis).
  function weightedSample(items, weightOf, n, rand) {
    return items
      .map(it => ({ it, k: Math.pow(rand(), 1 / Math.max(weightOf(it), 1e-6)) }))
      .sort((a, b) => b.k - a.k)
      .slice(0, n)
      .map(x => x.it);
  }

  // Pick questions for a practice session.
  //   mode: 'smart' | 'weak' | 'unseen' | 'random'
  function pickQuestions(questions, stats, mode, n, rand) {
    rand = rand || Math.random;
    if (mode === 'random') return shuffle(questions, rand).slice(0, n);
    if (mode === 'unseen') {
      return shuffle(questions.filter(q => !stats[q.id] || stats[q.id].c + stats[q.id].w === 0), rand).slice(0, n);
    }
    if (mode === 'weak') {
      const failed = questions.filter(q => stats[q.id] && stats[q.id].w > 0 && !isMastered(stats[q.id]));
      return weightedSample(failed, q => weakness(stats[q.id]), n, rand);
    }
    // smart: up to 60% failed questions (weakest most likely), the rest weighted towards unseen ones.
    const failed = questions.filter(q => stats[q.id] && stats[q.id].w > 0 && !isMastered(stats[q.id]));
    const weak = weightedSample(failed, q => weakness(stats[q.id]), Math.ceil(n * 0.6), rand);
    const taken = new Set(weak.map(q => q.id));
    const rest = weightedSample(questions.filter(q => !taken.has(q.id)), q => {
      const w = weakness(stats[q.id]);
      return w === null ? 0.6 : w;
    }, n - weak.length, rand);
    return shuffle(weak.concat(rest), rand);
  }

  // Mock exam like the real test: n random questions from the whole bank.
  function pickExam(questions, n, rand) {
    return shuffle(questions, rand || Math.random).slice(0, n);
  }

  function summary(questions, stats) {
    let seen = 0, mastered = 0, right = 0, wrong = 0, weak = 0;
    for (const q of questions) {
      const r = stats[q.id];
      if (!r || r.c + r.w === 0) continue;
      seen++;
      right += r.c;
      wrong += r.w;
      if (isMastered(r)) mastered++;
      else if (r.w > 0) weak++;
    }
    return { total: questions.length, seen, mastered, weak, right, wrong };
  }

  const api = { HISTORY, recordAnswer, mergeDevices, weakness, isMastered, pickQuestions, pickExam, summary, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(this);
