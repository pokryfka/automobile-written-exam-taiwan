#!/usr/bin/env python3
"""Extract the Taiwan car written-exam question bank PDF into app/data/questions.json.

Usage:
    pip install pdfplumber
    python3 tools/extract_questions.py path/to/exam.pdf            # writes app/data/
    python3 tools/extract_questions.py path/to/exam.pdf --debug 3  # dump page 3 layout

The official PDF is a table with the columns: number, answer, question text
(with an optional illustration) and category code. True/false questions use
O / X answers, multiple-choice questions use 1 / 2 / 3 with options written
inline as "(1) ... (2) ... (3) ...". Use --debug to inspect a page's word
positions if the layout changes and rows are missed.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "data"

TF_HEADER = re.compile(r"true\s*(or|/)\s*false|是非題", re.I)
MC_HEADER = re.compile(r"multiple[\s-]*choice|選擇題", re.I)
HEADER_WORDS = re.compile(r"^(no\.?|number|題號|answer|答案|question|題目|category|分類|分類編號|code)$", re.I)
NUM = re.compile(r"^\d{1,4}$")
TF_ANS = {"O": True, "○": True, "Ｏ": True, "X": False, "×": False, "Ｘ": False}
MC_ANS = {"1": 0, "2": 1, "3": 2, "4": 3, "①": 0, "②": 1, "③": 2, "④": 3}
OPTION_SPLIT = re.compile(r"[（(]\s*([1-4])\s*[)）]")
CATEGORY = re.compile(r"^\d{2,4}$")


def group_lines(words, tol=3):
    """Group words into visual lines by their top coordinate."""
    lines = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if lines and abs(lines[-1]["top"] - w["top"]) <= tol:
            lines[-1]["words"].append(w)
        else:
            lines.append({"top": w["top"], "bottom": w["bottom"], "words": [w]})
        lines[-1]["bottom"] = max(lines[-1]["bottom"], w["bottom"])
    for ln in lines:
        ln["words"].sort(key=lambda w: w["x0"])
    return lines


def parse_page(page):
    """Split a page into question rows.

    A row starts on a line whose first word is a question number in the left
    margin followed by an answer token; a category code is a short number at
    the far right. Any other line continues the previous question.
    """
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5)
    lines = group_lines(words)
    rows = []  # each: dict(no, ans, parts, category, top, bottom, section)
    section = None
    for ln in lines:
        ws = ln["words"]
        text = " ".join(w["text"] for w in ws)
        if len(text) < 80 and TF_HEADER.search(text):
            section = "tf"
        elif len(text) < 80 and MC_HEADER.search(text):
            section = "mc"
        if sum(1 for w in ws if HEADER_WORDS.match(w["text"])) >= 3:
            continue
        cat = ""
        if len(ws) > 1 and CATEGORY.match(ws[-1]["text"]) and ws[-1]["x0"] > page.width * 0.75:
            cat, ws = ws[-1]["text"], ws[:-1]
        starts = (len(ws) >= 2 and NUM.match(ws[0]["text"]) and ws[0]["x0"] < page.width * 0.15
                  and (ws[1]["text"] in TF_ANS or ws[1]["text"] in MC_ANS))
        if starts:
            body = " ".join(w["text"] for w in ws[2:])
            rows.append({"no": int(ws[0]["text"]), "ans": ws[1]["text"], "parts": [body] if body else [],
                         "category": cat, "top": ln["top"], "bottom": ln["bottom"], "section": section})
        elif rows:
            if ws:
                rows[-1]["parts"].append(" ".join(w["text"] for w in ws))
            if cat and not rows[-1]["category"]:
                rows[-1]["category"] = cat
            rows[-1]["bottom"] = ln["bottom"]
    return rows, section


def join_text(parts):
    text = " ".join(p.strip() for p in parts if p.strip())
    return re.sub(r"\s+", " ", text).strip()


def split_options(text):
    pieces = OPTION_SPLIT.split(text)
    if len(pieces) < 5:
        return None, None
    stem = pieces[0].strip()
    options = {}
    for i in range(1, len(pieces) - 1, 2):
        options[int(pieces[i])] = pieces[i + 1].strip(" ;；。.")
    ordered = [options[k] for k in sorted(options)]
    if sorted(options) != list(range(1, len(ordered) + 1)):
        return None, None
    return stem, ordered


def save_images(page, rows, img_dir, page_no):
    """Crop each embedded picture and attach it to the question row it sits in."""
    for img in page.images:
        mid = (img["top"] + img["bottom"]) / 2
        owner = next((r for r in rows if r["top"] - 4 <= mid <= r["bottom"] + 40), None)
        if owner is None:
            owner = min(rows, key=lambda r: abs(r["top"] - img["top"]), default=None)
        if owner is None or owner.get("image"):
            continue
        bbox = (max(img["x0"], 0), max(img["top"], 0), min(img["x1"], page.width), min(img["bottom"], page.height))
        if bbox[2] - bbox[0] < 8 or bbox[3] - bbox[1] < 8:
            continue
        name = f"p{page_no:03d}_{owner['no']:04d}.png"
        page.crop(bbox).to_image(resolution=200).save(img_dir / name)
        owner["image"] = "images/" + name


def debug_page(pdf, n):
    page = pdf.pages[n - 1]
    for ln in group_lines(page.extract_words(x_tolerance=1.5)):
        print(f"{ln['top']:7.1f} | " + "  ".join(f"[{w['x0']:.0f}]{w['text']}" for w in ln["words"]))
    print("images:", [(round(i["x0"]), round(i["top"]), round(i["x1"]), round(i["bottom"])) for i in page.images])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--debug", type=int, help="print word layout of this 1-based page and exit")
    ap.add_argument("--no-images", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    questions, problems = [], []
    with pdfplumber.open(args.pdf) as pdf:
        if args.debug:
            debug_page(pdf, args.debug)
            return
        section = None
        for page_no, page in enumerate(pdf.pages, 1):
            rows, sec = parse_page(page)
            for r in rows:
                r["section"] = r["section"] or section
            section = sec or section
            if not args.no_images:
                save_images(page, rows, img_dir, page_no)
            for r in rows:
                text = join_text(r["parts"])
                kind = r["section"] or ("tf" if r["ans"] in TF_ANS else "mc")
                q = {"no": r["no"], "type": kind, "category": r["category"] or None}
                if kind == "tf":
                    if r["ans"] not in TF_ANS:
                        problems.append(f"page {page_no} #{r['no']}: true/false answer {r['ans']!r}")
                        continue
                    q.update(q=text, answer=TF_ANS[r["ans"]])
                else:
                    stem, options = split_options(text)
                    if not options or r["ans"] not in MC_ANS or MC_ANS[r["ans"]] >= len(options):
                        problems.append(f"page {page_no} #{r['no']}: cannot parse options/answer: {text[:80]!r} ans={r['ans']!r}")
                        continue
                    q.update(q=stem, options=options, answer=MC_ANS[r["ans"]])
                if r.get("image"):
                    q["image"] = r["image"]
                q["id"] = f"{kind}-{r['no']}"
                questions.append(q)

    seen = {}
    for q in questions:
        if q["id"] in seen:
            problems.append(f"duplicate id {q['id']}")
        seen[q["id"]] = q
    questions = list(seen.values())
    for q in questions:
        if q["category"] is None:
            del q["category"]

    (out / "questions.json").write_text(json.dumps({"questions": questions}, ensure_ascii=False, indent=1))
    tf = sum(q["type"] == "tf" for q in questions)
    print(f"wrote {len(questions)} questions ({tf} true/false, {len(questions) - tf} choice, "
          f"{sum('image' in q for q in questions)} with images) to {out / 'questions.json'}")
    if problems:
        print(f"{len(problems)} problems:", file=sys.stderr)
        for p in problems[:50]:
            print("  " + p, file=sys.stderr)


if __name__ == "__main__":
    main()
