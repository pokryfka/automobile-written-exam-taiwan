#!/usr/bin/env python3
"""Extract the Taiwan automobile written-exam question bank PDFs into app/data/.

Usage:
    pip install pdfplumber
    python3 tools/extract_questions.py --lang en english.pdf        # reference edition, run first
    python3 tools/extract_questions.py --lang zh-Hant chinese.pdf   # each further language
    python3 tools/extract_questions.py --lang en english.pdf --debug 3   # dump page 3 rows

Written for the Highway Bureau (公路局) question banks, Year 115 edition, 1090 questions,
in English ("Automobile Written Exam Question Bank") and Chinese (新版汽車筆試題庫). Each
question is a table row with three cells: number, answer such as "(2)", and the question
text with its options written inline as "(1) ... (2) ... (3) ...", sometimes with
pictures. Section ("SECTION 1 ..." / "架構一 ...") and topic headings sit between the
rows. A row cut by a page break continues on the next page in a row with an empty number.

Output:
    bank.json           language-neutral: id, number, answer, section/topic keys, pictures,
                        and the list of available languages
    text/<lang>.json    question and option text plus section/topic names, keyed by id
    images/*.png        pictures, extracted from the reference (English) edition only

The English edition defines the question ids (a hash of its text and pictures, so stats
survive renumbering in a future edition). Other languages are matched to it by question
number and must agree on the answer and the pictures, otherwise the script stops.
Questions that appear twice in the bank are merged into one entry, with the extra numbers
in "also".
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "data"
REFERENCE = "en"
LANGUAGE_NAMES = {
    "en": "English", "zh-Hant": "中文", "ja": "日本語", "id": "Bahasa Indonesia",
    "vi": "Tiếng Việt", "th": "ไทย", "km": "ខ្មែរ", "my": "မြန်မာ",
}

ANSWER = re.compile(r"^\(?\s*([1-3])\s*\)?$")
SECTION = re.compile(r"^(SECTION\s+\d+|架構[一二三四五六七八九十]+)\s*\S")
TOPIC_MARK = re.compile(r"^(▸|分類)\s*")
# Running page headers and footers, and the table header rows ("No. Ans Question", 題號 / 答案 / 題目).
PAGE_FURNITURE = re.compile(r"Question Bank \| Year|^—\s*\d+\s*—$|^新版汽車筆試題庫\s*[\d.]+$|^第\s*\d+\s*頁$"
                            r"|^No\.\s+Ans\s+Question$|^▎?題號|^[答案]$")
FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
CJK = re.compile(r"[　-鿿＀-￯]")
IMAGE_DPI = 300

# Numbers that hold a different question in a language's edition than in the reference
# (English) edition, found by comparing all 1090 pairs by hand. These questions get no
# text in that language, so the app shows them in English only.
MISMATCHED = {
    # 新版汽車筆試題庫 115.5.29 vs the English Year 115 edition announced June 2026.
    # English #1036 matches Chinese #704 (and English #704); the other three have no Chinese equivalent.
    "zh-Hant": {52, 164, 913, 1036},
}

# Corrections to headings in an edition. The English edition labels two topics
# "Turning (Left / Right Turns, U-turns)"; the Chinese edition shows the second one
# (questions about large vehicles) is 注意大型車行駛及轉彎（內輪差、視野死角、不並行）.
# The English name below is our translation, not text from the official PDF.
# Keyed by (heading text, occurrence number).
TOPIC_NAME_FIXES = {
    "en": {("Turning (Left / Right Turns, U-turns)", 2):
           "Watch for Large Vehicles (Inner Wheel Difference, Blind Spots, No Driving Alongside)"},
}


# ---------- PDF parsing (language-neutral) ----------

def cell_lines(page, bbox):
    text = page.crop(bbox).extract_text(x_tolerance=1.5) or ""
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def join_lines(lines, cjk=True):
    """Join wrapped lines: a space between words, nothing after a hyphen or (if cjk) between CJK characters."""
    out = ""
    for line in lines:
        if not out:
            out = line
        elif out.endswith("-") and not out.endswith(" -"):
            out += line  # word broken at a hyphen, e.g. "non-" + "construction"
        elif cjk and (CJK.match(out[-1]) or CJK.match(line[0])):
            out += line
        else:
            out += " " + line
    return re.sub(r"\s+", " ", out).strip()


def page_rows(page):
    """Table rows in reading order: dict(no, ans, bbox, top, bottom); header rows have a non-numeric no."""
    rows = []
    for table in page.find_tables():
        if table.bbox[2] - table.bbox[0] < 400:
            continue  # nested layout boxes inside a question cell
        for row in table.rows:
            cells = sorted((c for c in row.cells if c), key=lambda c: c[0])
            no = next((c for c in cells if c[0] < 80 and 20 < c[2] - c[0] < 60), None)
            # The answer cell follows the number cell, sometimes after a thin spacer cell.
            ans = no and next((c for c in cells if -2 <= c[0] - no[2] <= 12 and 15 < c[2] - c[0] < 45), None)
            if not (no and ans):
                continue
            # The number cell spans the whole row; the question cell may be split
            # into sub-cells around a picture, so take the full width to its right.
            rows.append({"no": join_lines(cell_lines(page, no)), "ans": join_lines(cell_lines(page, ans)),
                         "bbox": (ans[2], no[1], table.bbox[2], no[3]), "top": no[1], "bottom": no[3]})
    rows.sort(key=lambda r: r["top"])
    return rows


def page_headings(page, rows):
    """(top, kind, text) for section and topic headings: text lines outside every table row."""
    found = []
    for ln in page.extract_text_lines(x_tolerance=1.5):
        text, mid = ln["text"].strip(), (ln["top"] + ln["bottom"]) / 2
        if not text or PAGE_FURNITURE.search(text) or any(r["top"] <= mid <= r["bottom"] for r in rows):
            continue
        if SECTION.match(text):
            found.append((ln["top"], "section", text))
        else:
            found.append((ln["top"], "topic", TOPIC_MARK.sub("", text)))
    return found


def option_marks(page, bbox):
    """Positions of the "(1)" "(2)" "(3)" markers in a cell: list of (n, top, bottom, x0)."""
    marks, words = [], page.crop(bbox).extract_words(x_tolerance=1.5)
    for i, w in enumerate(words):
        t = w["text"].translate(FULLWIDTH_DIGITS).replace("（", "(").replace("）", ")")
        if i + 1 < len(words) and re.fullmatch(r"\(\s*[1-3]", t) and words[i + 1]["text"].startswith(")"):
            t += ")"  # "(2 )" is split into two words
        m = re.match(r"^\(\s*([1-3])\s*\)", t)
        if m:
            marks.append((int(m.group(1)), w["top"], w["bottom"], w["x0"]))
    return marks


def parse_pdf(path, lang, problems):
    """Every numbered row of the bank, in order: dict(no, ans, parts, section, topic, images, marks, page).

    parts holds the text lines of each table cell: one cell, or two when a page break splits the row.
    section and topic are (key, name) for the headings above the row.
    """
    raw = []
    with pdfplumber.open(path) as pdf:
        # Keys s1, s2… and t1, t2… number the headings that have questions under them, in order.
        section = topic = None
        sections = topics = 0
        heading = None  # the latest topic heading, keyed once a question follows it
        seen = {}  # topic heading text -> occurrences so far
        fixes = TOPIC_NAME_FIXES.get(lang, {})
        for page_no, page in enumerate(pdf.pages, 1):
            rows = page_rows(page)
            events = [(h[0], "h", h) for h in page_headings(page, rows)] + [(r["top"], "r", r) for r in rows]
            for _, kind, item in sorted(events, key=lambda e: e[0]):
                if kind == "h":
                    if item[1] == "section":
                        sections += 1
                        section, topic, heading = (f"s{sections}", item[2]), None, None
                    elif section:  # ignore title lines before the first section
                        seen[item[2]] = seen.get(item[2], 0) + 1
                        heading = fixes.get((item[2], seen[item[2]]), item[2])
                    continue
                if item["no"] and not item["no"].isdigit():
                    continue  # header row
                lines = cell_lines(page, item["bbox"])
                imgs = [(page, i) for i in page.images
                        if item["top"] - 2 <= (i["top"] + i["bottom"]) / 2 <= item["bottom"] + 2
                        and i["x0"] >= item["bbox"][0] - 2]
                marks = [(page, m) for m in option_marks(page, item["bbox"])]
                if not item["no"]:
                    if raw:  # continuation of a question split by a page break
                        raw[-1]["parts"].append(lines)
                        raw[-1]["images"] += imgs
                        raw[-1]["marks"] += marks
                    else:
                        problems.append(f"page {page_no}: continuation row before any question")
                    continue
                if heading:
                    topics += 1
                    topic, heading = (f"t{topics}", heading), None
                raw.append({"no": int(item["no"]), "ans": item["ans"], "parts": [lines], "section": section,
                            "topic": topic, "images": imgs, "marks": marks, "page": page_no})
    return raw


def split_options(text):
    """Split "stem (1) a (2) b (3) c" into ("stem", [a, b, c]); options may be empty (picture options)."""
    pos, cur = [], 0
    for n in (1, 2, 3):
        m = re.compile(r"\(\s*%d\s*\)" % n).search(text, cur)
        if not m:
            return None, None
        pos.append(m)
        cur = m.end()
    stem = text[:pos[0].start()].strip()
    options = [text[pos[i].end():pos[i + 1].start() if i < 2 else len(text)].strip() for i in range(3)]
    return stem, options


def normalise(text, lang):
    if lang == REFERENCE:
        # Unchanged since v1.0.0: question ids are hashes of this exact text.
        text = text.replace("（", "(").replace("）", ")").replace(".。", ".").replace("。", ". ")
        # A stray "[" sits next to many pictures in the PDF; "[Refer to image]" is redundant next to the picture.
        text = re.sub(r"^\s*\[(\s*Refer to image\s*\])?", "", text)
    else:
        text = text.translate(FULLWIDTH_DIGITS).replace("（", "(").replace("）", ")")
        text = re.sub(r"^\s*\[", "", text)
        # Justified lines in the PDF leave spaces between characters, e.g. "考 領".
        text = re.sub(r"(?<=[\u3000-\u9fff\uff00-\uffef]) +(?=[\u3000-\u9fff\uff00-\uffef])", "", text)
    return re.sub(r"\s+", " ", text).strip()


def comes_after(img, mark):
    """True if the picture follows the marker in reading order."""
    _, top, bottom, x0 = mark
    if img["top"] >= bottom - 1:
        return True
    return img["bottom"] > top and img["x0"] >= x0


def split_pictures(r):
    """(question pictures, {1: [..], 2: [..], 3: [..]} option pictures or None) for a row with picture options."""
    opt_imgs, q_imgs = {1: [], 2: [], 3: []}, []
    for page, img in r["images"]:
        owner = None
        for mpage, mark in r["marks"]:
            if mpage is page and comes_after(img, mark):
                owner = mark[0]
        (opt_imgs[owner] if owner else q_imgs).append((page, img))
    return q_imgs, opt_imgs


def parse_question(r, lang, problems):
    """(stem, options, answer index) or None, recording a problem."""
    where = f"#{r['no']} (page {r['page']})"
    if lang == REFERENCE:
        # Exactly as in v1.0.0, since ids are hashes of this text: cells joined with a space, no CJK rule.
        text = " ".join(t for t in (join_lines(p, cjk=False) for p in r["parts"]) if t)
    else:
        text = join_lines([line for p in r["parts"] for line in p])
    stem, options = split_options(normalise(text, lang))
    m = ANSWER.match(r["ans"])
    if options is None:
        problems.append(f"{where}: cannot find options (1) (2) (3)")
        return None
    options = ["" if re.fullmatch(r"[\s。.、]*", o) else o for o in options]  # e.g. a stray "。" after picture options
    if not m:
        problems.append(f"{where}: unexpected answer {r['ans']!r}")
        return None
    if not all(options) and any(options):
        problems.append(f"{where}: some options empty: {options}")
        return None
    return stem, options, int(m.group(1)) - 1


# ---------- output ----------

def save_image(page, img, path):
    bbox = (max(img["x0"], 0), max(img["top"], 0), min(img["x1"], page.width), min(img["bottom"], page.height))
    page.crop(bbox).to_image(resolution=IMAGE_DPI).save(path)


def image_digest(img):
    try:
        return hashlib.sha1(img["stream"].get_data()).hexdigest()
    except Exception:
        return "%.0f,%.0f" % (img["width"], img["height"])


def check_numbers(numbers, problems):
    missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers)) if numbers else []
    if missing:
        problems.append(f"missing numbers: {missing[:30]}{' …' if len(missing) > 30 else ''}")
    dupes = sorted({n for n in numbers if numbers.count(n) > 1})
    if dupes:
        problems.append(f"duplicate numbers: {dupes[:30]}")


def build_reference(raw, out, lang, save_images, problems):
    img_dir = out / "images"
    if save_images:
        img_dir.mkdir(parents=True, exist_ok=True)
        for old in img_dir.glob("*.png"):
            old.unlink()
    sections = dict(r["section"] for r in raw if r["section"])
    topics = dict(r["topic"] for r in raw if r["topic"])
    questions, texts, by_id = [], {}, {}
    for r in raw:
        parsed = parse_question(r, lang, problems)
        if not parsed:
            continue
        stem, options, answer = parsed
        q_imgs, opt_imgs = r["images"], None
        if not all(options):
            q_imgs, opt_imgs = split_pictures(r)
            if any(len(v) != 1 for v in opt_imgs.values()):
                problems.append(f"#{r['no']}: expected one picture per option, got {[len(v) for v in opt_imgs.values()]}")
                continue
        # Id from the content (pictures included), so stats survive renumbering in a future edition.
        digest = "\n".join([stem] + options + [image_digest(i) for _, i in r["images"]])
        qid = hashlib.sha1(digest.encode()).hexdigest()[:10]
        if qid in by_id:
            by_id[qid].setdefault("also", []).append(r["no"])  # identical question listed twice in the bank
            continue
        q = {"id": qid, "no": r["no"], "section": r["section"] and r["section"][0],
             "topic": r["topic"] and r["topic"][0], "answer": answer}
        for k, (page, img) in enumerate(q_imgs):
            name = f"{r['no']:04d}" + (f"_{k}" if k else "") + ".png"
            if save_images:
                save_image(page, img, img_dir / name)
            q.setdefault("images", []).append("images/" + name)
        if opt_imgs:
            q["optionImages"] = []
            for n in (1, 2, 3):
                name = f"{r['no']:04d}_o{n}.png"
                if save_images:
                    save_image(*opt_imgs[n][0], img_dir / name)
                q["optionImages"].append("images/" + name)
        by_id[qid] = q
        questions.append(q)
        texts[qid] = {"q": stem, "options": options}

    check_numbers([q["no"] for q in questions] + [n for q in questions for n in q.get("also", [])], problems)
    base = {"version": 2, "languages": [], "questions": questions}
    text = {"language": lang, "sections": sections, "topics": topics, "questions": texts}
    return base, text


def build_translation(raw, base, lang, problems):
    by_no = {}
    for q in base["questions"]:
        for n in [q["no"]] + q.get("also", []):
            by_no[n] = q
    seen = {r["no"] for r in raw}
    check_numbers(sorted(seen), problems)
    missing = sorted(set(by_no) - seen)
    if missing:
        problems.append(f"numbers in the reference edition but not in this one: {missing[:30]}")
    extra = sorted(seen - set(by_no))
    if extra:
        problems.append(f"numbers in this edition but not in the reference one: {extra[:30]}")

    texts, section_names, topic_names = {}, {}, {}
    mismatched = MISMATCHED.get(lang, set())
    for r in raw:
        q = by_no.get(r["no"])
        if r["no"] in mismatched:
            continue
        parsed = q and parse_question(r, lang, problems)
        if not parsed:
            continue
        stem, options, answer = parsed
        where = f"#{r['no']} (page {r['page']})"
        if answer != q["answer"]:
            problems.append(f"{where}: answer ({answer + 1}) differs from the reference edition ({q['answer'] + 1})")
        pictures = len(q.get("images", [])) + len(q.get("optionImages", []))
        if len(r["images"]) != pictures:
            problems.append(f"{where}: {len(r['images'])} pictures, the reference edition has {pictures}")
        if bool(q.get("optionImages")) == all(options):
            problems.append(f"{where}: picture options do not match the reference edition")
        section_names.setdefault(q["section"], set()).add(r["section"] and r["section"][1])
        topic_names.setdefault(q["topic"], set()).add(r["topic"] and r["topic"][1])
        if r["no"] == q["no"]:  # merged duplicates take the text of their first number
            texts[q["id"]] = {"q": stem, "options": options}

    def names(found, kind):
        out = {}
        for key, values in found.items():
            values.discard(None)
            if key and len(values) != 1:
                problems.append(f"{kind} {key} maps to {len(values)} names in this edition: {sorted(values)}")
            elif key:
                out[key] = values.pop()
        return out

    return {"language": lang, "sections": names(section_names, "section"),
            "topics": names(topic_names, "topic"), "questions": texts}


def detect_edition(path):
    """(label, ISO date or None) from the edition printed on the first pages, or (None, None)."""
    with pdfplumber.open(path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages[:2])
    # Chinese header: 新版汽車筆試題庫 115.5.29, a Republic of China (民國) date; year + 1911 = Gregorian.
    m = re.search(r"汽車筆試題庫\s*(\d{2,3})\.(\d{1,2})\.(\d{1,2})", text)
    if m:
        y, mo, d = (int(g) for g in m.groups())
        return f"{y}.{mo}.{d}", f"{y + 1911:04d}-{mo:02d}-{d:02d}"
    # English header: "Year 115 Edition", title page: "New Edition — Announced June 2026".
    m = re.search(r"Year\s+(\d+)\s+Edition", text)
    if m:
        announced = re.search(r"Announced\s+([A-Z][a-z]+\s+\d{4})", text)
        return f"Year {m.group(1)} edition" + (f", announced {announced.group(1)}" if announced else ""), None
    return None, None


def language_entry(lang, edition, date, count):
    entry = {"code": lang, "name": LANGUAGE_NAMES.get(lang, lang), "edition": edition, "questions": count}
    if date:
        entry["date"] = date
    return entry


def debug_page(path, n):
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[n - 1]
        rows = page_rows(page)
        print("headings:", page_headings(page, rows))
        for r in rows:
            print(f"{r['top']:6.0f} no={r['no']!r} ans={r['ans']!r} q={join_lines(cell_lines(page, r['bbox']))[:100]!r}")
        print("images:", [tuple(round(i[k]) for k in ("x0", "top", "x1", "bottom")) for i in page.images])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--lang", required=True, help=f"language code, e.g. {', '.join(LANGUAGE_NAMES)}")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--debug", type=int, help="print the rows of this 1-based page and exit")
    ap.add_argument("--no-images", action="store_true", help="reference edition: do not write picture files")
    ap.add_argument("--edition", help="edition label, if it cannot be read from the PDF (e.g. 115.5.29)")
    args = ap.parse_args()
    if args.debug:
        debug_page(args.pdf, args.debug)
        return

    out = Path(args.out)
    base_path = out / "bank.json"
    problems = []
    edition, date = detect_edition(args.pdf)
    if args.edition:
        edition, date = args.edition, None
    if not edition:
        problems.append("cannot find the edition in the PDF; pass it with --edition")
    raw = parse_pdf(args.pdf, args.lang, problems)
    if args.lang == REFERENCE:
        base, text = build_reference(raw, out, args.lang, not args.no_images, problems)
        old = json.loads(base_path.read_text()).get("languages", []) if base_path.exists() else []
        base["languages"] = [language_entry(args.lang, edition, date, len(text["questions"]))] + \
            [l for l in old if l["code"] != args.lang]  # keep the other languages listed
    else:
        if not base_path.exists():
            sys.exit(f"{base_path} not found: extract the reference edition first (--lang {REFERENCE})")
        base = json.loads(base_path.read_text())
        text = build_translation(raw, base, args.lang, problems)
        missing = [q["no"] for q in base["questions"]
                   if q["id"] not in text["questions"] and q["no"] not in MISMATCHED.get(args.lang, set())]
        if missing:
            problems.append(f"no text for numbers {missing[:30]}")
        base["languages"] = [l for l in base["languages"] if l["code"] != args.lang] + \
            [language_entry(args.lang, edition, date, len(text["questions"]))]

    if problems:
        print(f"{len(problems)} problems, nothing written:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        sys.exit(1)

    text = {"language": text["language"], "edition": edition, **({"date": date} if date else {}),
            **{k: v for k, v in text.items() if k != "language"}}
    (out / "text").mkdir(parents=True, exist_ok=True)
    base_path.write_text(json.dumps(base, ensure_ascii=False, indent=1) + "\n")
    (out / "text" / f"{args.lang}.json").write_text(json.dumps(text, ensure_ascii=False, indent=1) + "\n")
    qs = base["questions"]
    print(f"{args.lang} ({edition}): {len(text['questions'])} questions, {len(text['sections'])} sections, "
          f"{len(text['topics'])} topics; base has {len(qs)} questions "
          f"({sum('images' in q for q in qs)} with pictures, {sum('optionImages' in q for q in qs)} with picture options, "
          f"{sum(len(q.get('also', [])) for q in qs)} duplicates merged), languages: "
          f"{', '.join(l['code'] for l in base['languages'])}")


if __name__ == "__main__":
    main()
