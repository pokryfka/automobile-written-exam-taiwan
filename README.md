# Taiwan Car Written Exam Practice

Practise for Taiwan's car driving licence written test (汽車筆試) with the official question
bank: 1090 questions in Chinese and English. The app works in any modern browser on phones,
tablets and computers. It also works offline, remembers which questions you get wrong, and
can sync your progress between your devices.

**Open the app:** https://car-exam.fyi

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
(繁體中文，台灣)**. It starts in English. To change it, tap the flag in the top bar, next to ⚙️,
and pick a language. This setting is separate from the language of the questions.

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

If you [sync your devices](#syncing-between-your-devices), your language choices sync too: the app
language, the second question language and the language you last used for a question.

## Syncing between your devices

Your progress is saved on each device. To share it between your phone, tablet or computer,
use a **sync code**. You don't need an account.

1. On your first device, tap ⚙️, choose **Sync code** as the **Sync method**, and tap
   **Create a new code**. You get a code like `MBD8-D3CN-FCD3`.
2. On each other device, choose **Sync code**, type the code under **Use an existing code**,
   and tap **Link this device**. Capital letters, dashes and spaces don't matter. **Copy**, and
   **Share** where your browser supports it, help you send the code to your other device.

**Keep the code private:** anyone who has it can see and change your progress. **Write it
down:** if you lose it, nobody can look it up for you.

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
  and language choices you make. Nothing else about you is stored.
- The server keeps your results under a scrambled form of your sync code, not the code itself.

## Where the questions come from

The questions, answers and pictures come from the official question bank PDFs published by
the Highway Bureau (公路局), Ministry of Transportation and Communications, on its
[car question bank page](https://www.thb.gov.tw/News_Download.aspx?n=284&sms=12823).

## Feedback

Found a wrong answer, a typo or a bug? Please
[open an issue](https://github.com/pokryfka/car-exam-tw/issues).

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
