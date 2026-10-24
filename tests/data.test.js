// Consistency of the extracted question bank: app/data/bank.json and app/data/text/<lang>.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'app', 'data');
const bank = JSON.parse(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8'));
const texts = Object.fromEntries(bank.languages.map(l =>
  [l.code, JSON.parse(fs.readFileSync(path.join(dir, 'text', l.code + '.json'), 'utf8'))]));

test('English is the first language and covers every question', () => {
  assert.strictEqual(bank.languages[0].code, 'en');
  for (const q of bank.questions) assert.ok(texts.en.questions[q.id], `#${q.no} has no English text`);
});

test('question ids and numbers are unique', () => {
  const ids = bank.questions.map(q => q.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  const nos = bank.questions.flatMap(q => [q.no].concat(q.also || []));
  assert.strictEqual(new Set(nos).size, nos.length);
});

test('every question has a valid answer and existing pictures', () => {
  for (const q of bank.questions) {
    assert.ok([0, 1, 2].includes(q.answer), `#${q.no} answer`);
    for (const p of (q.images || []).concat(q.optionImages || [])) {
      assert.ok(fs.existsSync(path.join(dir, p)), `#${q.no} missing ${p}`);
    }
  }
});

for (const [lang, text] of Object.entries(texts)) {
  test(`${lang}: text matches the bank`, () => {
    const byId = Object.fromEntries(bank.questions.map(q => [q.id, q]));
    for (const [id, t] of Object.entries(text.questions)) {
      const q = byId[id];
      assert.ok(q, `${lang} has text for unknown id ${id}`);
      assert.strictEqual(t.options.length, 3, `#${q.no} options`);
      // Picture options have no text; text options are never empty.
      for (const o of t.options) assert.strictEqual(o === '', !!q.optionImages, `#${q.no} option text`);
      assert.ok(t.q || q.images || q.optionImages, `#${q.no} has neither text nor picture`);
    }
    for (const q of bank.questions) {
      assert.ok(text.sections[q.section], `${lang} has no name for section ${q.section}`);
      assert.ok(text.topics[q.topic], `${lang} has no name for topic ${q.topic}`);
    }
  });
}
