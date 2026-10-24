# Taiwan Car Written Exam Practice

A small web app for practising the English edition of Taiwan's automobile written-exam
question bank (汽車筆試題庫, Year 115 edition, 1090 questions). It works on iPhone, iPad
and desktop browsers, works offline, remembers which questions you get wrong, and can
sync your progress between devices.

**Open the app:** https://car-exam-tw.pokryfka.workers.dev

> Version 1.0.0 is still available at https://pokryfka.github.io/automobile-written-exam-taiwan/
> but no longer updated.

## Install it on your iPhone or iPad

1. Open the link above in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Launch it from the Home Screen. It opens full screen and keeps working offline.

> The Home Screen app and the Safari tab keep separate data. Use the Home Screen app and set
> up sync (below) so your progress is never lost.

## Practising

| Mode | What it does |
|---|---|
| 🎯 **Smart** | About 60% questions you have failed (the weakest come up most often), the rest mostly new ones |
| 🔥 **Mistakes** | Only questions you have answered wrong and not yet mastered |
| 🆕 **New** | Questions you have never answered |
| 🎲 **Random** | Any question |
| 📝 **Mock exam** | 40 random questions from the whole bank, 85 points to pass |
| 📊 **Weak list** | Your 50 most-failed questions, with a button to practise them |

- After each answer the app shows whether you were right and highlights the correct option.
- A question counts as **mastered** once your last 3 answers to it were correct. Mastered
  questions come up rarely, and a new mistake brings them back.
- Use the **Section** and **Topic** filters to focus on one part of the bank. They apply to
  the practice modes but not to the mock exam.

## Syncing between iPhone and iPad

Your stats are saved on each device. To share them between devices, tap ⚙️ and pick a
**Sync method**:

| Method | Needs | Where the stats are stored |
|---|---|---|
| **Sync code** (simplest) | Nothing | This app's server, under a random code |
| **GitHub Gist** | A GitHub account | A private gist in your own GitHub account |

### Sync code

1. On the first device, choose **Sync code** and tap **Create a new code**. You get a code
   like `MBD8-D3CN-FCD3`.
2. On each other device, choose **Sync code**, type the code under **Use an existing code**
   and tap **Link this device**. Capitals, dashes and spaces don't matter. **Copy** and, on
   iPhone and iPad, **Share** help you send the code to your other device.

Anyone with the code can see and change those stats, so keep it private. The server stores
only a hash of the code, not the code itself, so write it down: it cannot be recovered.

### GitHub Gist

1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**.
2. Create a token with **Account permissions → Gists: Read and write** and nothing else.
   Pick an expiry, for example one year. A classic token with only the `gist` scope also works.
3. In the app, choose **GitHub Gist**, paste the token and tap **Save & sync now**.
   The first device creates a gist named `taiwan-car-exam-stats.json`.
4. Paste the same token on your other device. It finds the same gist automatically.

The token stays on the device and is sent only to `api.github.com`. When it expires,
create a new one and paste it on each device; your stats stay in the gist.

### How sync works

- Sync runs on its own: a few seconds after you answer, when you leave the app and when
  you open it. The dot in the top bar shows the status (green = synced, yellow = syncing,
  red = failed; tap ⚙️ to see the error). Answers made offline sync once you are online.
- Each device writes only its own entry, so two devices can never overwrite each other's
  answers. The app adds the entries together for your stats.
- Only numbers are stored per question: times right, times wrong, your last 5 results and
  when you last answered it, plus the device name you choose.

## Updating the question bank

The questions come from the official PDF published by the Highway Bureau (公路局), MOTC.
When a new edition comes out:

```sh
pip install pdfplumber
python3 tools/extract_questions.py path/to/question-bank.pdf
```

This rewrites `app/data/questions.json` and `app/data/images/`. The script checks that every
question number is present and that each question has three options and an answer, and
exits with a list of problems if not. Use `--debug <page>` to see how it reads one page.

- Each question's id is a hash of its text and pictures, so your stats carry over to a new
  edition for every question that did not change.
- Questions that appear twice in the bank are merged into one, and the extra number is
  listed in `also`.

## Development

The app in `app/` is plain HTML, CSS and JavaScript with no build step. It is served by a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) (`worker/`, TypeScript) that
also provides the sync API, backed by a [D1](https://developers.cloudflare.com/d1/) (SQLite)
database.

```sh
npm ci
npx wrangler d1 migrations apply car-exam-tw --local   # create the local database
npm run dev                                            # http://localhost:8787
npm test                                               # app unit tests + Worker tests
npm run typecheck
```

| Path | Contents |
|---|---|
| `app/index.html`, `app/styles.css` | Page and styles |
| `app/app.js` | Screens, local storage and both sync methods |
| `app/core.js` | Stats merging and question selection (also used by the tests) |
| `app/sw.js` | Service worker that caches the app and all pictures for offline use |
| `app/data/` | Extracted questions and pictures |
| `worker/src/index.ts` | Sync API (`GET /api/sync/:code`, `PUT /api/sync/:code/:deviceId`); other paths serve `app/` |
| `worker/test/` | Worker tests, run inside the Workers runtime with a local D1 database |
| `migrations/` | D1 schema migrations |
| `wrangler.jsonc` | Worker configuration for production and QA |
| `tools/extract_questions.py` | PDF → `questions.json` extractor |
| `tests/` | Unit tests for `app/core.js` |

After changing `wrangler.jsonc`, run `npm run types` to regenerate
`worker/worker-configuration.d.ts`.

## Deployment

Changes go through pull requests. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
runs the type check and tests on every pull request and push, then deploys:

| Environment | URL | Database | Deployed when |
|---|---|---|---|
| QA | https://car-exam-tw-qa.pokryfka.workers.dev | `car-exam-tw-qa` | A pull request is opened or updated |
| Production | https://car-exam-tw.pokryfka.workers.dev | `car-exam-tw` | A pull request is merged to `main` |

Each deploy first applies new migrations from `migrations/` to that environment's database.
Pull requests from forks run the tests only.

**Settings, all in `wrangler.jsonc`:**
- Worker names and database names and IDs for each environment.
- Rate limit: requests per minute per client IP to the sync API.
- `MAX_BODY_BYTES`: the largest upload accepted.
- `MAX_DEVICES_PER_CODE`: how many devices can share one sync code.

**Running your own copy:**

1. Create two D1 databases in your Cloudflare account and put their names and IDs in
   `wrangler.jsonc`. Change the Worker `name` if you like.
2. Change the rate-limit `namespace_id`s if they clash with ones already in your account.
3. Create a Cloudflare API token from the **Edit Cloudflare Workers** template with
   **Account → D1 → Edit** added.
4. In the GitHub repository, add the secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
5. Update the environment URLs in `.github/workflows/deploy.yml` to match your
   `workers.dev` subdomain.

## Disclaimer

This is an unofficial study aid. The question bank belongs to the Highway Bureau, MOTC,
Taiwan. Always check the latest official edition before your exam.
