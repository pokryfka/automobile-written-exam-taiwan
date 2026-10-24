# Taiwan Car Written Exam Practice

A small web app for practising the English edition of Taiwan's automobile written-exam
question bank (汽車筆試題庫, Year 115 edition, 1090 questions). It works on iPhone, iPad
and desktop browsers, works offline, remembers which questions you get wrong, and can
sync your progress between devices.

**Open the app:** https://pokryfka.github.io/automobile-written-exam-taiwan/

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

Your stats are saved on each device. To share them between devices, the app stores them
in a **private (secret) GitHub Gist** in your own GitHub account.

1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**.
2. Create a token with **Account permissions → Gists: Read and write** and nothing else.
   Pick an expiry, for example one year.
3. In the app, tap ⚙️, paste the token, give the device a name and tap **Save & sync now**.
   The first device creates a gist named `taiwan-car-exam-stats.json`.
4. Paste the same token on your other device. It finds the same gist automatically.

After that, sync runs on its own: a few seconds after you answer, when you leave the app
and when you open it. The dot in the top bar shows the status (green = synced,
yellow = syncing, red = failed; tap ⚙️ to see the error). Answers made offline are synced
the next time you are online.

How it works:
- Each device writes only its own section of the gist, so two devices can never overwrite
  each other's answers. The app adds the sections together for your stats.
- Only numbers are stored per question: times right, times wrong, your last 5 results and
  when you last answered it.
- The token stays on the device (in the app's local storage) and is sent only to
  `api.github.com`. It can only access gists, not your repositories.
- When the token expires, create a new one and paste it on each device. Your stats stay in
  the gist.

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

There is no build step. The app is plain HTML, CSS and JavaScript in `app/`.

```sh
python3 -m http.server -d app 8000   # then open http://localhost:8000
node --test tests/*.test.js          # unit tests for the stats and question selection logic
```

| Path | Contents |
|---|---|
| `app/index.html`, `app/styles.css` | Page and styles |
| `app/app.js` | Screens, local storage and Gist sync |
| `app/core.js` | Stats merging and question selection (also used by the tests) |
| `app/sw.js` | Service worker that caches the app and all pictures for offline use |
| `app/data/` | Extracted questions and pictures |
| `tools/extract_questions.py` | PDF → `questions.json` extractor |
| `.github/workflows/pages.yml` | Runs the tests and deploys `app/` to GitHub Pages on every push to `main` |

**One-time GitHub Pages setup:** in the repository on GitHub, go to **Settings → Pages**
and set **Source** to **GitHub Actions**.

## Disclaimer

This is an unofficial study aid. The question bank belongs to the Highway Bureau, MOTC,
Taiwan. Always check the latest official edition before your exam.
