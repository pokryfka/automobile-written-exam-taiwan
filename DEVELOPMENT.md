# Development

How the app is built, tested and deployed, and how the question bank is updated. For using
the app, see the [README](README.md).

## Overview

- **App:** `app/` is plain HTML, CSS and JavaScript with no build step. It's an installable web
  app (PWA), and a service worker caches it and every picture for offline use.
- **Worker:** a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (`worker/`,
  TypeScript) serves the app and provides the sync API.
- **Database:** the sync API stores its data in a [D1](https://developers.cloudflare.com/d1/)
  (SQLite) database.
- **Question data:** extracted from the official PDFs by a Python script (`tools/`) and
  committed to `app/data/`.

## Local development

```sh
npm ci
npx wrangler d1 migrations apply car-exam-tw --local   # create the local database
npm run dev                                            # http://localhost:8787
npm test                                               # app unit tests, data checks and Worker tests
npm run typecheck
```

After changing `wrangler.jsonc`, run `npm run types` to regenerate
`worker/worker-configuration.d.ts`.

## Project layout

| Path | Contents |
|---|---|
| `app/index.html`, `app/styles.css` | Page and styles |
| `app/app.js` | Screens, local storage, interface and question languages, and both sync methods |
| `app/i18n/` | Interface translations, one file per language |
| `app/core.js` | Stats merging and question selection (also used by the tests) |
| `app/sw.js` | Service worker that caches the app, question text and all pictures for offline use |
| `app/data/` | Extracted questions and pictures (see below) |
| `worker/src/index.ts` | Sync API; other paths serve `app/` |
| `worker/test/` | Worker tests, run inside the Workers runtime with a local D1 database |
| `migrations/` | D1 schema migrations |
| `wrangler.jsonc` | Worker configuration for production and QA |
| `tools/extract_questions.py` | PDF → `bank.json` and `text/<lang>.json` extractor |
| `tools/extract_hazard.py` | Hazard-perception PDFs → `hazard.json` extractor |
| `tools/write_version.mjs` | Writes `app/version.json` before each deploy (see [Versions](#versions)) |
| `tests/` | Unit tests for `app/core.js` and consistency checks for `app/data/` |

## Stats and sync

**On the device:**
- Each device keeps its own stats in `localStorage`, keyed by question id:
  `{ c, w, u, h, t }`.
  - `c` and `w`: times right and wrong.
  - `u`: how many of the right answers were marked **Unsure**. It's only present once one was.
  - `h`: the last 5 results, newest last: `1` right, `0` wrong, `2` right but unsure.
  - `t`: the time of the last answer.
- A question needs review once it has a wrong or unsure answer, until it's mastered: the last 3
  results are `111`. An unsure answer counts half as much as a wrong one when ranking weak
  questions (`app/core.js`).
- Stats from all devices are summed for display.

**Shared document format:** both sync methods use the same document,
`{ devices: { [deviceId]: { name, updated, stats, prefs } } }`. Each device writes only its own
entry, so devices never overwrite each other.

**Language choices (`prefs`):**
- `prefs` holds `{ uiLang, secondLang, questionLang, updated }`, where `updated` is when this
  device's choices last changed.
- After each sync the app applies the most recently updated `prefs` from any other device, if
  they're newer than its own.

**Sync code:** handled by the Worker's API.
- `GET /api/sync/:code` returns all devices' entries for a code.
- `PUT /api/sync/:code/:deviceId` with `{ name, stats, prefs }` saves one device's entry and
  returns all of them. `prefs` is optional, so older versions of the app keep working.
- `GET /api/config` returns the deployment's features, `{ environment, gistSync }`.
- A code is 12 Crockford base32 characters (60 random bits) generated in the app. Lower case,
  dashes, spaces, O→0 and I/L→1 are accepted.
- The database stores the code's SHA-256 only. Each device is one row, keyed by
  `(code_hash, device_id)`. The `prefs` column was added by migration `0002`.
- Requests are validated and limited: a body size limit, a maximum number of devices per code,
  and a per-IP rate limit (see [Deployment](#deployment)).

**GitHub Gist (QA only):**
- The app stores the same document in a private gist named `taiwan-car-exam-stats.json`, using
  the GitHub API with the user's token.
- The token is stored only in the device's `localStorage`.
- It's offered only where `GIST_SYNC` is `"true"` in `wrangler.jsonc`: QA but not production.
  The app reads this from `GET /api/config`, which returns `{ environment, gistSync }`, and
  remembers it for offline use.
- A device already set to Gist sync keeps the option, and keeps syncing, in every environment.

To use it:
1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**.
2. Create a token with **Account permissions → Gists: Read and write** and nothing else.
   A classic token with only the `gist` scope also works.
3. In the app, choose **GitHub Gist**, paste the token, and tap **Save & sync now**.
4. Paste the same token on your other devices. They find the same gist automatically.

## Interface translations

- **Where the strings live:** interface text is in `app/i18n/<code>.json`, a flat map of keys
  to strings with `{name}` placeholders, for example `"sync.synced": "Synced {time}"`.
- **Using them:** `t(key, vars)` in `app/app.js` returns *live* text: it becomes the string in
  the current interface language (falling back to English, then to the key itself) whenever it's
  used.
  - Elements built with `h()` remember the live text they show.
  - Switching the language updates only that text in place (`refreshLive`), so the screen,
    scroll position, typed input and answers stay as they are.
  - Use `tr(key, vars)` when you need the plain string now, for example for stored values or
    comparisons.
- **Choosing the language:**
  - The interface language is chosen from the flag menu in the top bar, independently of the
    question languages. Flags are inline SVG (`FLAGS` in `app/app.js`), since Windows shows flag
    emoji as letters.
  - The default is English.
  - The choice is synced between devices (see [Stats and sync](#stats-and-sync)).
- **Section and topic names** follow the interface language when the question bank has them
  in that language, otherwise English.
- **Offline:** the service worker precaches the English and Chinese string files.
- **Tests:** `tests/i18n.test.js` checks that every language file has the same keys and
  placeholders as `en.json`, and that every key the app uses exists.

To add an interface language:
1. Copy `app/i18n/en.json` to `app/i18n/<code>.json` and translate the values, keeping the keys
   and placeholders.
2. Add the language to `UI_LANGS` in `app/app.js`, with its own name, its locale for
   formatting times, and a flag (add the flag's SVG to `FLAGS` if it's new).
3. Add the file to `SHELL` in `app/sw.js` if it should work offline from the first visit.

## Question data

| File | Contents |
|---|---|
| `app/data/bank.json` | Language-neutral: id, number, answer, section and topic keys, pictures, and the list of languages with their editions |
| `app/data/text/<lang>.json` | Question and option text plus section and topic names, keyed by question id |
| `app/data/images/` | Pictures, taken from the English edition and shared by all languages |
| `app/data/hazard.json` | The hazard-perception video questions, with their text in each language and video links. The app adds them to the bank as the section `hazard` |

**Languages in the app:**
- Chinese (`zh-Hant`) is always offered, together with one second language chosen in settings
  (English by default).
- English (`en`) is always loaded. It's the reference edition, it provides the section and
  topic names for the English interface, and it's the fallback for questions missing in
  other languages.

## Updating the question bank

The source PDFs are on the Highway Bureau's
[car question bank page](https://www.thb.gov.tw/News_Download.aspx?n=284&sms=12823). Extract
the English edition first, since it defines the question ids, answers and pictures, then each
further language:

```sh
pip install pdfplumber
python3 tools/extract_questions.py --lang en      english.pdf
python3 tools/extract_questions.py --lang zh-Hant chinese.pdf
```

**Rules the script follows:**
- **Question ids** are a hash of the English text and pictures, so users' stats carry over to a
  new edition for every question that did not change.
- **Other languages** are matched to English by question number. The script stops if a number
  is missing, or if an answer or the number of pictures differs.
- **Mismatched questions:** some numbers hold a different question in different editions.
  These are listed in `MISMATCHED` in the script after comparing all questions by hand, and
  are shown in English only. For the Chinese edition 115.5.29 that is #52, #164, #913 and #1036.
- **Duplicates:** questions that appear twice in the bank are merged into one, and the extra
  number is listed in `also`.
- **Corrected topic name:** the English edition labels two topics "Turning". The second one
  (questions #623–654) gets a corrected name in `TOPIC_NAME_FIXES`.

**Editions:**
- The script reads each language's edition from its PDF ("Year 115 edition, announced June
  2026", "115.5.29").
- It records the edition with the question count in `bank.json`, and the app shows them in
  ⚙️ → Data.
- If the edition can't be found, pass it with `--edition`.

**To add another language,** such as Japanese (`ja`) or Indonesian (`id`):
1. Run the script with that code.
2. Compare the questions with English and list any mismatches in `MISMATCHED`.
3. Check that the language's name is in `LANGUAGE_NAMES`.

Use `--debug <page>` to see how the script reads one page.

**Hazard-perception video questions** (汽車危險感知影片選擇題) are a separate one-page PDF per
language on the same page. They're kept in their own file, so re-running the script above
doesn't touch them:

```sh
python3 tools/extract_hazard.py --edition 115.6.5 --date 2026-06-05 \
    --lang en english.pdf --lang zh-Hant chinese.pdf
```

- **Ids:** a hash of the English text, prefixed with `h`.
- **Checks:** the script stops if a language is missing a question, or has a different answer
  or video number than English.
- **Edition:** the PDFs don't print their edition, so pass it from the bank page or the file
  name (`1150605-…` is 115.6.5).

## Mock exam

The rules are in `EXAM` in `app/app.js`. They follow the Highway Bureau's
[online practice test](https://www.mvdis.gov.tw/m3-simulator-drv/index): 50 random questions,
5 of them hazard-perception questions, 2 points each, 85 points to pass.

**Answering:** the mock exam has its own screen (`examView` in `app/app.js`). Answers and
unsure marks are kept in the session and can be changed until the exam is handed in
(`submitExam`), which records them in the stats. Practice modes record each answer at once.

**Time limit:**
- Users choose one of `EXAM_TIME_LIMITS` in ⚙️ → Mock exam (`settings.examMinutes`). The
  default is `OFFICIAL_EXAM_MINUTES` (30).
- The countdown runs from the start time stored in the session, so it keeps going while the app
  is in the background.
- When `EXAM_WARN_MINUTES` are left, a message shows once and the clock turns red.
- When the time is up, the exam ends: unanswered questions count as wrong in the score but
  aren't recorded in the stats.

## Deployment

Changes go through pull requests. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
runs the type check and tests on every pull request and push, then deploys:

| Environment | URL | Database | Deployed when |
|---|---|---|---|
| QA | https://qa.car-exam.fyi | `car-exam-tw-qa` | A pull request is opened or updated |
| Production | https://car-exam.fyi | `car-exam-tw` | A release tag such as `v2.1.0` is pushed |

Merging to `main` doesn't deploy. To release:
1. Create a release on GitHub with a new tag such as `v2.1.0` on `main`, or push the tag.
2. The tag must look like `v1.2.3` and point to a commit on `main`, otherwise production isn't
   deployed.
3. If the `production` environment requires approval, approve the deploy on the workflow run.

Each deploy first applies new migrations from `migrations/` to that environment's database.
Both environments also stay on their `workers.dev` addresses (`car-exam-tw.pokryfka.workers.dev`
and `car-exam-tw-qa.pokryfka.workers.dev`).
Pull requests from forks run the tests only.

**Settings, all in `wrangler.jsonc`:**
- Worker names, custom domains (`routes`), and database names and IDs, for each environment.
- Rate limit: requests per minute per client IP to the sync API.
- `MAX_BODY_BYTES`: the largest upload accepted.
- `MAX_DEVICES_PER_CODE`: how many devices can share one sync code.
- `GIST_SYNC`: whether new users are offered GitHub Gist sync (`"true"` in QA, `"false"` in
  production).

**Running your own copy:**

1. Create two D1 databases in your Cloudflare account and put their names and IDs in
   `wrangler.jsonc`. Change the Worker `name` if you like.
2. Change the rate-limit `namespace_id`s if they clash with ones already in your account.
3. Create a Cloudflare API token from the **Edit Cloudflare Workers** template with
   **Account → D1 → Edit** added.
4. In the GitHub repository, add the secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
5. Put your own domains in `routes`, or remove `routes` to use only `workers.dev`. A custom
   domain must be a zone in the same Cloudflare account.
6. Update the environment URLs in `.github/workflows/deploy.yml` to match.

## Versions

⚙️ → Support shows the version the app is running. A release links to its release notes on
GitHub. Any other version shows its commit id, linking to the commit:

| Deployed from | Shown |
|---|---|
| A release tag, such as `v2.0.0` | `Version v2.0.0` |
| 3 commits after that tag | `Version v2.0.0+3 (1a2b3c4)` |
| A pull request, on QA | `Version v2.0.0+4 (9f8e7d6) · QA` |
| `npm run dev` | `Version dev` |

- Before each deploy, `tools/write_version.mjs` replaces `app/version.json` (committed as
  `"dev"`) with the latest `v*` tag, the number of commits since it, the commit id and the
  environment.
- The service worker caches `version.json` with the rest of the app, so the version shown is
  the one the device is actually running.
- Production shows plain release versions, since only release tags are deployed there. QA shows
  the commits since the last release.
