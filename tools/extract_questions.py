#!/usr/bin/env python3
"""Extract the Taiwan automobile written-exam question bank PDF into app/data/.

Usage:
    pip install pdfplumber
    python3 tools/extract_questions.py path/to/question-bank.pdf
    python3 tools/extract_questions.py path/to/question-bank.pdf --debug 3   # dump page 3 table cells

Written for the English edition "Automobile Written Exam Question Bank | Year 115
Edition" (1090 questions). Each question is a table row with three cells:
number, answer such as "(2)", and the question text with its options written
inline as "(1) ... (2) ... (3) ...", sometimes with an illustration. Section
("SECTION 1 ...") and topic ("▸ ...") headings sit between the tables. A row
cut by a page break continues on the next page in a row with an empty number.

Writes app/data/questions.json and app/data/images/*.png. Questions that appear
twice in the bank are merged into one entry, with the extra numbers in "also".
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

NO_RIGHT = 94     # right edge of the "No." column
ANS_RIGHT = 128   # right edge of the "Ans" column
ANSWER = re.compile(r"^\(?([1-3])\)?$")
SECTION = re.compile(r"^SECTION\s+(\d+)\s+(.+)$")
TOPIC = re.compile(r"^▸\s*(.+)$")
IMAGE_DPI = 300


def cell_text(page, bbox):
    """Text of a table cell, wrapped lines joined into one string."""
    text = page.crop(bbox).extract_text(x_tolerance=1.5) or ""
    out = ""
    for line in (ln.strip() for ln in text.splitlines()):
        if not line:
            continue
        if not out:
            out = line
        elif out.endswith("-") and not out.endswith(" -"):
            out += line  # word broken at a hyphen, e.g. "non-" + "construction"
        else:
            out += " " + line
    return re.sub(r"\s+", " ", out).strip()


def page_headings(page):
    """(top, kind, text) for every section / topic heading on the page."""
    found = []
    for ln in page.extract_text_lines(x_tolerance=1.5):
        text = ln["text"].strip()
        if SECTION.match(text):
            found.append((ln["top"], "section", text))
        elif TOPIC.match(text):
            found.append((ln["top"], "topic", TOPIC.match(text).group(1).strip()))
    return found


def page_rows(page):
    """Question rows of the page in reading order: dict(no, ans, bbox, top)."""
    rows = []
    for table in page.find_tables():
        x0, top, x1, bottom = table.bbox
        if x1 - x0 < 400:
            continue  # nested layout boxes inside a question cell
        for row in table.rows:
            cells = [c for c in row.cells if c]
            no = next((c for c in cells if c[2] <= NO_RIGHT + 1 and c[2] - c[0] > 20), None)
            ans = next((c for c in cells if c[0] >= NO_RIGHT - 1 and c[2] <= ANS_RIGHT + 1 and c[2] - c[0] > 20), None)
            if not (no and ans):
                continue
            # The number cell spans the whole row; the question cell may be split
            # into sub-cells around a picture, so take the full width to its right.
            q = (ans[2], no[1], x1, no[3])
            no_text, ans_text = cell_text(page, no), cell_text(page, ans)
            if no_text == "No.":
                continue  # header row
            rows.append({"no": no_text, "ans": ans_text, "bbox": q, "top": no[1], "bottom": no[3]})
    rows.sort(key=lambda r: r["top"])
    return rows


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


def option_marks(page, bbox):
    """Positions of the "(1)" "(2)" "(3)" markers in a cell: list of (n, top, bottom, x0)."""
    marks, words = [], page.crop(bbox).extract_words(x_tolerance=1.5)
    for i, w in enumerate(words):
        t = w["text"]
        if i + 1 < len(words) and re.fullmatch(r"\(\s*[1-3]", t) and words[i + 1]["text"].startswith(")"):
            t += ")"  # "(2 )" is split into two words
        m = re.match(r"^\(\s*([1-3])\s*\)", t)
        if m:
            marks.append((int(m.group(1)), w["top"], w["bottom"], w["x0"]))
    return marks


def comes_after(img, mark):
    """True if the picture follows the marker in reading order."""
    _, top, bottom, x0 = mark
    if img["top"] >= bottom - 1:
        return True
    return img["bottom"] > top and img["x0"] >= x0


def normalise(text):
    text = text.replace("（", "(").replace("）", ")").replace(".。", ".").replace("。", ". ")
    # A stray "[" sits next to many pictures in the PDF; "[Refer to image]" is redundant next to the picture.
    text = re.sub(r"^\s*\[(\s*Refer to image\s*\])?", "", text)
    return re.sub(r"\s+", " ", text).strip()


def save_image(page, img, path):
    bbox = (max(img["x0"], 0), max(img["top"], 0), min(img["x1"], page.width), min(img["bottom"], page.height))
    page.crop(bbox).to_image(resolution=IMAGE_DPI).save(path)


def image_digest(img):
    try:
        return hashlib.sha1(img["stream"].get_data()).hexdigest()
    except Exception:
        return "%.0f,%.0f" % (img["width"], img["height"])


def debug_page(pdf, n):
    page = pdf.pages[n - 1]
    print("headings:", page_headings(page))
    for r in page_rows(page):
        print(f"{r['top']:6.0f} no={r['no']!r} ans={r['ans']!r} q={cell_text(page, r['bbox'])[:100]!r}")
    print("images:", [tuple(round(i[k]) for k in ("x0", "top", "x1", "bottom")) for i in page.images])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--debug", type=int, help="print the rows of this 1-based page and exit")
    ap.add_argument("--no-images", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    img_dir = out / "images"
    problems = []
    raw = []  # questions before option splitting: dict(no, ans, parts, section, topic, images)
    with pdfplumber.open(args.pdf) as pdf:
        if args.debug:
            debug_page(pdf, args.debug)
            return
        if not args.no_images:
            img_dir.mkdir(parents=True, exist_ok=True)
            for old in img_dir.glob("*.png"):
                old.unlink()
        section = topic = None
        for page_no, page in enumerate(pdf.pages, 1):
            headings = page_headings(page)
            rows = page_rows(page)
            events = [(h[0], "h", h) for h in headings] + [(r["top"], "r", r) for r in rows]
            for _, kind, item in sorted(events, key=lambda e: e[0]):
                if kind == "h":
                    if item[1] == "section":
                        section, topic = item[2], None
                    else:
                        topic = item[2]
                    continue
                text = cell_text(page, item["bbox"])
                imgs = [(page, i) for i in page.images
                        if item["top"] - 2 <= (i["top"] + i["bottom"]) / 2 <= item["bottom"] + 2
                        and i["x0"] >= item["bbox"][0] - 2]
                marks = [(page, m) for m in option_marks(page, item["bbox"])]
                if not item["no"]:
                    if raw:  # continuation of a question split by a page break
                        raw[-1]["parts"].append(text)
                        raw[-1]["images"] += imgs
                        raw[-1]["marks"] += marks
                    continue
                if not item["no"].isdigit():
                    problems.append(f"page {page_no}: unexpected number cell {item['no']!r}")
                    continue
                raw.append({"no": int(item["no"]), "ans": item["ans"], "parts": [text], "section": section,
                            "topic": topic, "images": imgs, "marks": marks, "page": page_no})

        questions, by_id = [], {}
        for r in raw:
            where = f"#{r['no']} (page {r['page']})"
            stem, options = split_options(normalise(" ".join(p for p in r["parts"] if p)))
            m = ANSWER.match(r["ans"])
            if options is None:
                problems.append(f"{where}: cannot find options (1) (2) (3)")
                continue
            if not m:
                problems.append(f"{where}: unexpected answer {r['ans']!r}")
                continue
            q_imgs, opt_imgs = r["images"], None
            if not all(options):
                # Picture options: each picture belongs to the last marker before it.
                if any(options) or not r["marks"]:
                    problems.append(f"{where}: some options empty: {options}")
                    continue
                opt_imgs, q_imgs = {1: [], 2: [], 3: []}, []
                for page, img in r["images"]:
                    owner = None
                    for mpage, mark in r["marks"]:
                        if mpage is page and comes_after(img, mark):
                            owner = mark[0]
                    (opt_imgs[owner] if owner else q_imgs).append((page, img))
                if any(len(v) != 1 for v in opt_imgs.values()):
                    problems.append(f"{where}: expected one picture per option, got {[len(v) for v in opt_imgs.values()]}")
                    continue
            # Id from the content (pictures included), so stats survive renumbering in a future edition.
            digest = "\n".join([stem] + options + [image_digest(i) for _, i in r["images"]])
            qid = hashlib.sha1(digest.encode()).hexdigest()[:10]
            if qid in by_id:
                by_id[qid].setdefault("also", []).append(r["no"])  # identical question listed twice in the bank
                continue
            q = {"id": qid, "no": r["no"], "section": r["section"], "topic": r["topic"],
                 "q": stem, "options": options, "answer": int(m.group(1)) - 1}
            if not args.no_images:
                for k, (page, img) in enumerate(q_imgs):
                    name = f"{r['no']:04d}" + (f"_{k}" if k else "") + ".png"
                    save_image(page, img, img_dir / name)
                    q.setdefault("images", []).append("images/" + name)
                if opt_imgs:
                    q["optionImages"] = []
                    for n in (1, 2, 3):
                        name = f"{r['no']:04d}_o{n}.png"
                        save_image(*opt_imgs[n][0], img_dir / name)
                        q["optionImages"].append("images/" + name)
            by_id[qid] = q
            questions.append(q)

    nos = [q["no"] for q in questions] + [n for q in questions for n in q.get("also", [])]
    missing = sorted(set(range(1, max(nos) + 1)) - set(nos)) if nos else []
    if missing:
        problems.append(f"missing numbers: {missing[:30]}{' …' if len(missing) > 30 else ''}")
    dupes = sorted({n for n in nos if nos.count(n) > 1})
    if dupes:
        problems.append(f"duplicate numbers: {dupes[:30]}")

    out.mkdir(parents=True, exist_ok=True)
    (out / "questions.json").write_text(json.dumps({"questions": questions}, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {len(questions)} questions to {out / 'questions.json'}: "
          f"{sum('images' in q for q in questions)} with pictures, {sum('optionImages' in q for q in questions)} with picture options, "
          f"{sum(len(q.get('also', [])) for q in questions)} duplicates merged, {len(nos)} numbers covered")
    if problems:
        print(f"{len(problems)} problems:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
