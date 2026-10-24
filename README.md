# Taiwan Car Written Exam Practice

Practise for Taiwan's car driving licence written test (汽車筆試) with the official question
bank: 1090 questions in Chinese and English. The app works in any modern browser on phones,
tablets and computers. It also works offline, remembers which questions you get wrong, and
can sync your progress between your devices.

**Open the app:** https://car-exam-tw.pokryfka.workers.dev

It's free, and you don't need an account.

## Install it as an app

Open the link above, then add it to your home screen or install it:
- **Safari:** tap **Share** → **Add to Home Screen**.
- **Chrome on Android:** tap **⋮** → **Add to Home screen** (or **Install app**).
- **Chrome or Edge on a computer:** click the install icon in the address bar.

It then opens in its own window and keeps working without an internet connection.

> On some devices the installed app and the browser tab keep separate progress. Use the
> installed app, and set up [sync](#syncing-between-your-devices) so your progress is never lost.

## Practising

Pick a mode on the home screen:

| Mode | What it does |
|---|---|
| 🎯 **Smart** | Mostly questions you got wrong before (the hardest ones come up most often), plus new ones |
| 🔥 **Mistakes** | Only questions you got wrong and haven't mastered yet |
| 🆕 **New** | Questions you have never answered |
| 🎲 **Random** | Any question |
| 📝 **Mock exam** | 40 random questions from the whole bank, 85 points to pass |
| 📊 **Weak list** | Your 50 most-missed questions, with a button to practise them |

- After each answer you see whether you were right, and the correct answer is highlighted.
- A question counts as **mastered** once you have answered it correctly 3 times in a row.
  Mastered questions come up rarely, and a new mistake brings them back.
- Use the **Section** and **Topic** filters to focus on one part of the bank. They apply to
  the practice modes but not to the mock exam.
- Choose how many questions a session has: 10, 20, 40 or 80.

> **The test has changed.** Since 30 June 2026 (民國115年6月30日) the real test has 50
> questions, including 5 hazard-perception video questions. The mock exam still uses the
> previous format.

## Languages

**App language:** the app's buttons and menus are in **English** or **Traditional Chinese
(繁體中文，台灣)**. It starts in Chinese if your browser prefers Chinese, otherwise in English.
To change it, go to ⚙️ → **App language · 介面語言**. This setting is separate from the
language of the questions.

**Question language:** each question and its answers can be shown in **Chinese (中文)** or a
**second language**.
Tap **中文 / EN** above the question to switch. The next question opens in the language you
used last.

- Chinese is always available. The second language is English, and more languages may be
  added later. You choose the second language in ⚙️ → **Question languages**.
- The Chinese and English editions of the official bank were published at different times.
  You can see each edition in ⚙️ → **Data**. In the current editions, 4 question numbers
  (#52, #164, #913 and #1036) have different questions in each language, so those 4 are
  shown in English only.

## Syncing between your devices

Your progress is saved on each device. To share it between your phone, tablet or computer,
tap ⚙️ and choose a **Sync method**:

| Method | You need | Where your progress is kept |
|---|---|---|
| **Sync code** (easiest) | Nothing | On this app's server, under a private code |
| **GitHub Gist** | A GitHub account | In a private file in your own GitHub account |

### Sync code

1. On your first device, choose **Sync code** and tap **Create a new code**. You get a code
   like `MBD8-D3CN-FCD3`.
2. On each other device, choose **Sync code**, type the code under **Use an existing code**,
   and tap **Link this device**. Capital letters, dashes and spaces don't matter. **Copy**, and
   **Share** where your browser supports it, help you send the code to your other device.

**Keep the code private:** anyone who has it can see and change your progress. **Write it
down:** if you lose it, nobody can look it up for you.

### GitHub Gist

1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**.
2. Create a token with **Account permissions → Gists: Read and write** and nothing else.
   Pick an expiry, for example one year. A classic token with only the `gist` permission also works.
3. In the app, choose **GitHub Gist**, paste the token, and tap **Save & sync now**.
4. Paste the same token on your other devices. They find your progress automatically.

When the token expires, create a new one and paste it on each device. Your progress stays
in your GitHub account.

### How sync works

- Sync happens by itself: a few seconds after you answer, when you leave the app, and when
  you open it. The dot in the top bar shows the status: green means synced, yellow means
  syncing, and red means sync failed (tap ⚙️ to see why).
- If you practise offline, your answers sync the next time you're online.
- Your devices can't overwrite each other's progress. The app adds up the answers from all
  your devices.

## Privacy

- The app has no accounts, ads or analytics.
- **Without sync**, your progress stays on your device.
- **With sync**, only your practice results are stored: for each question, how often you got
  it right or wrong, your last 5 answers and when you last answered it, plus the device names
  you choose. Nothing else about you is stored.
- With a **sync code**, the server keeps your results under a scrambled form of the code, not
  the code itself.
- With a **GitHub Gist**, your results are stored only in your own GitHub account. Your token
  stays on your device and is only sent to GitHub.

## Where the questions come from

The questions, answers and pictures come from the official question bank PDFs published by
the Highway Bureau (公路局), Ministry of Transportation and Communications, on its
[car question bank page](https://www.thb.gov.tw/News_Download.aspx?n=284&sms=12823).

## Feedback

Found a wrong answer, a typo or a bug? Please
[open an issue](https://github.com/pokryfka/automobile-written-exam-taiwan/issues).

## Disclaimer

This is an unofficial study aid, not affiliated with the Highway Bureau. Always check the
latest official question bank and rules before your test.

## License

The app's code is available under the [MIT License](LICENSE). The questions, answers and
pictures come from the Highway Bureau's official question bank and are not covered by that
license.

---

For developers: see [DEVELOPMENT.md](DEVELOPMENT.md) for how the app is built, tested and
deployed, and how the question bank is updated.
