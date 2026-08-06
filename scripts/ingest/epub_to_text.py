"""Convert an EPUB into plain text compatible with data/texts/*.txt.

Usage:
    python scripts/ingest/epub_to_text.py path/to/book.epub data/texts/output-name.txt

Strips HTML markup and joins chapters with blank lines so api/_rag.js's
paragraph-based chunker (chunkText in api/_rag.js) splits it sensibly.
"""
import sys
import re
from pathlib import Path

from ebooklib import epub
import ebooklib


def epub_to_text(epub_path: str) -> str:
    book = epub.read_epub(epub_path)
    parts = []
    for item in book.get_items():
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        html = item.get_content().decode("utf-8", errors="ignore")
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
        text = re.sub(r"<(p|div|br|h[1-6])[^>]*>", "\n\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"&nbsp;", " ", text)
        text = re.sub(r"&amp;", "&", text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = text.strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts).strip()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    out = epub_to_text(src)
    Path(dst).write_text(out, encoding="utf-8")
    print(f"Wrote {len(out):,} chars to {dst}")
