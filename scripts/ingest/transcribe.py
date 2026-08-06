"""Transcribe an audio or video file into plain text compatible with data/texts/*.txt.

Runs locally via faster-whisper (CPU, free, no API key) -- ffmpeg must be on
PATH (faster-whisper/av use it to demux audio from video files too).

Usage:
    python scripts/ingest/transcribe.py path/to/talk.mp3 data/texts/output-name.txt
    python scripts/ingest/transcribe.py path/to/debate.mp4 data/texts/output-name.txt --model medium

Model sizes (accuracy vs. speed): tiny, base, small, medium, large-v3.
"small" is a reasonable default on a laptop CPU; "medium"+ is much slower
without a GPU.
"""
import sys
import argparse
from pathlib import Path

from faster_whisper import WhisperModel


def transcribe(path: str, model_size: str = "small") -> str:
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, beam_size=5)
    print(f"Detected language: {info.language} (p={info.language_probability:.2f})")
    lines = []
    for seg in segments:
        lines.append(seg.text.strip())
        print(f"[{seg.start:7.1f}s] {seg.text.strip()}")
    return " ".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    text = transcribe(args.src, args.model)
    Path(args.dst).write_text(text, encoding="utf-8")
    print(f"\nWrote {len(text):,} chars to {args.dst}")
