from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import markdown
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
DATA_DIR = WEB_DIR / "data"
OUT_FILE = DATA_DIR / "questions.js"


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    docs = [build_doc(path) for path in sorted(ROOT.glob("*.md"))]
    question_count = sum(len(doc["questions"]) for doc in docs)
    payload = {
        "meta": {
            "title": "嵌入式校招八股题库",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "docCount": len(docs),
            "questionCount": question_count,
        },
        "docs": docs,
    }
    OUT_FILE.write_text(
        "window.EMBEDDED_BANK_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Generated {OUT_FILE.relative_to(ROOT)}")
    print(f"Docs: {len(docs)}")
    print(f"Questions: {question_count}")


def build_doc(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    title = find_title(lines) or clean_filename(path)
    short_title = short_filename(path)
    slug = doc_slug(path)
    questions = parse_questions(lines)
    return {
        "slug": slug,
        "title": title,
        "shortTitle": short_title,
        "source": path.name,
        "html": markdown_to_html(text),
        "questions": questions,
    }


def parse_questions(lines: list[str]) -> list[dict]:
    questions: list[dict] = []
    current_section = ""
    current: dict | None = None
    buffer: list[str] = []
    in_fence = False
    fence_marker = ""

    def close_current() -> None:
        nonlocal current, buffer
        if not current:
            return
        body = "\n".join(buffer[1:]).strip()
        html = markdown_to_html(body)
        current["html"] = html
        current["search"] = compact_text(current["title"] + " " + html_to_text(html))
        questions.append(current)
        current = None
        buffer = []

    for line in lines:
        fence_match = re.match(r"^\s*(```+|~~~+)", line)
        if not in_fence and is_h2(line):
            close_current()
            current_section = clean_heading(line)
            continue

        match = None if in_fence else re.match(r"^###\s+(Q\d+)\s*[:：]?\s*(.+?)\s*$", line, re.IGNORECASE)
        if match:
            close_current()
            qid = match.group(1).upper()
            title = cleanup_inline(match.group(2))
            current = {
                "id": qid,
                "title": title,
                "section": current_section,
            }
            buffer = [line]
            continue

        if current:
            buffer.append(line)

        if fence_match:
            marker = fence_match.group(1)[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = ""

    close_current()
    return questions


def markdown_to_html(text: str) -> str:
    md = markdown.Markdown(
        extensions=[
            "fenced_code",
            "tables",
            "sane_lists",
            "toc",
        ],
        output_format="html5",
    )
    return md.convert(text)


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(" ", strip=True)


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def find_title(lines: list[str]) -> str | None:
    for line in lines:
        if re.match(r"^#\s+", line):
            return clean_heading(line)
    return None


def is_h2(line: str) -> bool:
    return bool(re.match(r"^##\s+", line)) and not re.match(r"^###\s+", line)


def clean_heading(line: str) -> str:
    value = re.sub(r"^(?:#+\s*)+", "", line).strip()
    return cleanup_inline(value)


def cleanup_inline(value: str) -> str:
    value = value.replace("**", "").replace("__", "")
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def doc_slug(path: Path) -> str:
    match = re.match(r"^(\d+)", path.stem)
    if match:
        return f"doc-{match.group(1)}"
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def clean_filename(path: Path) -> str:
    return cleanup_inline(path.stem)


def short_filename(path: Path) -> str:
    value = re.sub(r"^\d+_", "", path.stem)
    value = re.sub(r"面试题$", "", value)
    value = re.sub(r"基础$", "", value)
    return cleanup_inline(value)


if __name__ == "__main__":
    main()
