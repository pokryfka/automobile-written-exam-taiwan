// Writes app/version.json before a deploy, so the app can show which version it is running:
// the latest release tag, the number of commits since it, and the commit id.
// Usage: node tools/write_version.mjs <environment> [commit]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [environment, ref = 'HEAD'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const commit = git('rev-parse', ref);
let version = null; // no release tag yet
try {
  const [, tag, ahead] = git('describe', '--tags', '--long', '--match', 'v*', commit).match(/^(.+)-(\d+)-g[0-9a-f]+$/);
  version = +ahead ? `${tag}+${ahead}` : tag;
} catch (e) { /* no release tag */ }

const info = { version, commit, environment };
writeFileSync(new URL('../app/version.json', import.meta.url), JSON.stringify(info) + '\n');
console.log(info);
