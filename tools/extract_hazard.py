#!/usr/bin/env python3
"""Extract the car hazard-perception video questions (汽車危險感知影片選擇題) into app/data/hazard.json.

The Highway Bureau publishes them as a one-page table per language: number, answer, question with
its three options, and the number of the video, which links to the video on the bureau's file
server. The questions can be answered from the text alone; the video link is kept for watching.

Usage:
  python3 tools/extract_hazard.py --edition 115.6.5 --date 2026-06-05 \\
      --lang en english.pdf --lang zh-Hant chinese.pdf

English is required: question ids are a hash of the English text, like the written bank's.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "hazard.json"

SECTION_NAMES = {"en": "Hazard Perception Videos", "zh-Hant": "危險感知影片題"}
CJK = "　-〿㐀-鿿＀-￯"


def clean(text, lang):
    lines = [l.strip() for l in text.split("\n")]
    text = ("" if lang.startswith("zh") else " ").join(lines)
    text = re.sub(r"\s+", " ", text)
    if lang.startswith("zh"):
        text = re.sub(rf"(?<=[{CJK}]) (?=[{CJK}])", "", text)
    return text.strip()


def split_options(text, lang):
    """'Question? (1) a (2) b (3) c' -> ('Question?', ['a', 'b', 'c'])."""
    parts = re.split(r"\s*\(([1-3])\)\s*", text)
    if len(parts) != 7 or parts[1::2] != ["1", "2", "3"]:
        raise SystemExit(f"Cannot split options in: {text!r}")
    options = [re.sub(r"[、，,\s]+$", "", p) for p in parts[2::2]]
    return parts[0].strip(), options


def read(pdf_path, lang):
    """Rows of (number, answer index, question, options, video number, video url)."""
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != 1:
            raise SystemExit(f"{pdf_path}: expected one page, found {len(pdf.pages)}")
        page = pdf.pages[0]
        links = {}
        for link in page.hyperlinks:
            uri = link.get("uri") or ""
            if "space2.thb.gov.tw" in uri:
                links[round(link["top"])] = uri
        rows = []
        for table in page.find_tables():
            for row in table.rows:
                cells = [c for c in row.cells if c]
                texts = [(page.crop(c).extract_text() or "").strip() for c in cells]
                texts = [t for t in texts if t]
                if len(texts) < 4:
                    continue
                no, answer, question, video = texts[0], texts[1], texts[2], texts[-1]
                m = re.fullmatch(r"(?:危感-)?(\d{2})", no)
                a = re.fullmatch(r"\(([1-3])\)", answer)
                if not m or not a or not re.fullmatch(r"\d{6}", video):
                    continue
                top = row.bbox[1]
                bottom = row.bbox[3]
                url = next((u for t, u in links.items() if top - 2 <= t <= bottom + 2), None)
                q, options = split_options(clean(question, lang), lang)
                rows.append((int(m.group(1)), int(a.group(1)) - 1, q, options, video, url))
    if not rows:
        raise SystemExit(f"{pdf_path}: no questions found")
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", nargs=2, action="append", metavar=("CODE", "PDF"), required=True)
    ap.add_argument("--edition", required=True, help='as printed on the bank page, e.g. "115.6.5"')
    ap.add_argument("--date", required=True, help="ISO date of the edition, e.g. 2026-06-05")
    args = ap.parse_args()

    langs = {code: read(path, code) for code, path in args.lang}
    if "en" not in langs:
        raise SystemExit("The English edition is required: it defines the question ids.")
    reference = langs["en"]
    questions = []
    for no, answer, q, options, video, url in reference:
        digest = hashlib.sha1(("hazard\n" + q + "\n" + "\n".join(options)).encode()).hexdigest()
        entry = {"id": "h" + digest[:9], "no": no, "answer": answer, "video": video, "videoUrl": url, "text": {}}
        for code, rows in langs.items():
            match = next((r for r in rows if r[0] == no), None)
            if not match:
                raise SystemExit(f"{code}: question {no} is missing")
            if match[1] != answer or match[4] != video:
                raise SystemExit(f"{code}: question {no} has a different answer or video than English")
            entry["text"][code] = {"q": match[2], "options": match[3]}
            entry["videoUrl"] = entry["videoUrl"] or match[5]
        if not entry["videoUrl"]:
            raise SystemExit(f"question {no}: no video link found")
        questions.append(entry)

    data = {
        "edition": args.edition,
        "date": args.date,
        "sections": {code: SECTION_NAMES.get(code, SECTION_NAMES["en"]) for code in langs},
        "questions": questions,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"Wrote {len(questions)} questions in {', '.join(langs)} to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
