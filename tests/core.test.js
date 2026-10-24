const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core.js');

const qs = Array.from({ length: 50 }, (_, i) => ({ id: 'q' + i }));

test('recordAnswer keeps counts and short history', () => {
  const s = {};
  for (const ok of [true, false, true, true, true, true]) Core.recordAnswer(s, 'a', ok, 1);
  assert.deepStrictEqual(s.a, { c: 5, w: 1, h: '01111', t: 1 });
  assert.ok(Core.isMastered(s.a));
});

test('mergeDevices sums counts and takes history from latest device', () => {
  const m = Core.mergeDevices({
    phone: { stats: { a: { c: 1, w: 2, h: '001', t: 5 } } },
    pad: { stats: { a: { c: 3, w: 0, h: '111', t: 9 }, b: { c: 0, w: 1, h: '0', t: 1 } } },
  });
  assert.deepStrictEqual(m.a, { c: 4, w: 2, h: '111', t: 9 });
  assert.strictEqual(m.b.w, 1);
});

test('weakness ranks failed above passed and mastered lowest', () => {
  const failed = Core.weakness({ c: 1, w: 3, h: '0100', t: 0 });
  const ok = Core.weakness({ c: 3, w: 1, h: '0111', t: 0 });
  assert.ok(failed > ok);
  assert.strictEqual(Core.weakness(undefined), null);
});

test('weak mode only returns failed, non-mastered questions', () => {
  const stats = { q1: { c: 0, w: 2, h: '00', t: 1 }, q2: { c: 3, w: 1, h: '0111', t: 1 }, q3: { c: 2, w: 0, h: '11', t: 1 } };
  const ids = Core.pickQuestions(qs, stats, 'weak', 10).map(q => q.id);
  assert.deepStrictEqual(ids, ['q1']);
});

test('smart mode favours failed questions', () => {
  const stats = {};
  for (let i = 0; i < 40; i++) stats['q' + i] = i < 5 ? { c: 0, w: 3, h: '000', t: 1 } : { c: 3, w: 0, h: '111', t: 1 };
  let hits = 0;
  for (let r = 0; r < 200; r++) hits += Core.pickQuestions(qs, stats, 'smart', 10).filter(q => stats[q.id] && stats[q.id].w).length;
  assert.ok(hits / 200 > 4, 'expected most of the 5 failed questions in each session, got ' + hits / 200);
});

test('unseen mode and mock exam', () => {
  const stats = { q0: { c: 1, w: 0, h: '1', t: 1 } };
  assert.ok(!Core.pickQuestions(qs, stats, 'unseen', 100).some(q => q.id === 'q0'));
  const exam = Core.pickExam(qs, 40);
  assert.strictEqual(exam.length, 40);
  assert.strictEqual(new Set(exam.map(q => q.id)).size, 40);
});

test('an unsure correct answer counts as correct but keeps the question under review', () => {
  const s = {};
  Core.recordAnswer(s, 'a', true, 1, true);
  assert.deepStrictEqual(s.a, { c: 1, w: 0, u: 1, h: '2', t: 1 });
  assert.ok(Core.needsReview(s.a));
  // Unsure on a wrong answer is just a wrong answer.
  Core.recordAnswer(s, 'b', false, 1, true);
  assert.deepStrictEqual(s.b, { c: 0, w: 1, h: '0', t: 1 });
  // Records without unsure answers stay as before.
  Core.recordAnswer(s, 'c', true, 1, false);
  assert.deepStrictEqual(s.c, { c: 1, w: 0, h: '1', t: 1 });
  assert.ok(!Core.needsReview(s.c));
});

test('unsure answers break mastery and rank between wrong and sure answers', () => {
  const s = {};
  for (const [ok, unsure] of [[true, false], [true, false], [true, true]]) Core.recordAnswer(s, 'a', ok, 1, unsure);
  assert.strictEqual(s.a.h, '112');
  assert.ok(!Core.isMastered(s.a));
  for (let i = 0; i < 3; i++) Core.recordAnswer(s, 'a', true, 2);
  assert.ok(Core.isMastered(s.a));
  assert.ok(!Core.needsReview(s.a));

  const wrong = Core.weakness({ c: 2, w: 1, h: '110', t: 0 });
  const unsure = Core.weakness({ c: 3, w: 0, u: 1, h: '112', t: 0 });
  const sure = Core.weakness({ c: 3, w: 0, h: '111', t: 0 });
  assert.ok(wrong > unsure && unsure > sure, `expected ${wrong} > ${unsure} > ${sure}`);
});

test('weak mode and summary include unsure questions; merge sums unsure counts', () => {
  const stats = { q1: { c: 1, w: 0, u: 1, h: '2', t: 1 }, q2: { c: 2, w: 0, h: '11', t: 1 } };
  assert.deepStrictEqual(Core.pickQuestions(qs, stats, 'weak', 10).map(q => q.id), ['q1']);
  const sum = Core.summary(qs, stats);
  assert.strictEqual(sum.weak, 1);
  assert.strictEqual(sum.right, 3);
  const m = Core.mergeDevices({
    phone: { stats: { a: { c: 1, w: 0, u: 1, h: '2', t: 5 } } },
    pad: { stats: { a: { c: 2, w: 0, u: 1, h: '12', t: 9 }, b: { c: 1, w: 0, h: '1', t: 1 } } },
  });
  assert.deepStrictEqual(m.a, { c: 3, w: 0, u: 2, h: '12', t: 9 });
  assert.deepStrictEqual(m.b, { c: 1, w: 0, h: '1', t: 1 });
});
