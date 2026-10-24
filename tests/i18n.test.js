// Interface translations in app/i18n/: every language has the same keys and placeholders as English.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'app', 'i18n');
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const en = load('en.json');
const placeholders = s => (s.match(/\{\w+\}/g) || []).sort().join(' ');

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'en.json')) {
  test(`${file} matches en.json`, () => {
    const strings = load(file);
    assert.deepStrictEqual(Object.keys(strings).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      assert.ok(strings[key].trim(), `${file}: ${key} is empty`);
      assert.strictEqual(placeholders(strings[key]), placeholders(value), `${file}: placeholders of ${key}`);
    }
  });
}

test('the app uses only keys that exist in en.json', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  // Every quoted string that looks like a key, including keys chosen with a ternary;
  // prefixes completed at runtime ('gist.error' + status) are skipped.
  const namespaces = [...new Set(Object.keys(en).map(k => k.split('.')[0]))].join('|');
  const used = [...app.matchAll(new RegExp(`'((?:${namespaces})\\.[\\w-]+)'(?!\\s*\\+)`, 'g'))].map(m => m[1]);
  assert.ok(used.length > 80);
  for (const key of used) assert.ok(key in en, `missing key ${key}`);
});
