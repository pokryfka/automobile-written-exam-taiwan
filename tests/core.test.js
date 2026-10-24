const test = require('node:test');
const assert = require('node:assert');
const Core = require('../app/core.js');

const qs = Array.from({ length: 50 }, (_, i) => ({ id: 'q' + i, type: i % 2 ? 'mc' : 'tf' }));

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
  const exam = Core.pickExam(qs, Math.random, 20);
  assert.strictEqual(exam.filter(q => q.type === 'tf').length, 20);
  assert.strictEqual(exam.filter(q => q.type === 'mc').length, 20);
});
