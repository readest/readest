"""Transcribe an audiobook file using faster-whisper and write SRT or JSON output."""

import argparse
import os
import sys
import traceback


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe audiobook with faster-whisper")
    parser.add_argument("--audio", required=True, help="Path to the audio file")
    parser.add_argument("--output-dir", required=True, help="Directory to write transcript to")
    parser.add_argument("--model", default="base", help="Whisper model name (default: base)")
    parser.add_argument(
        "--format", default="srt", choices=["srt", "json"], help="Output format (default: srt)"
    )
    parser.add_argument("--language", default=None, help="Language code (optional)")
    args = parser.parse_args()

    audio_path: str = args.audio
    output_dir: str = args.output_dir
    model_name: str = args.model
    output_format: str = args.format
    language: str | None = args.language

    if not os.path.isfile(audio_path):
        print(f"Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "Missing faster-whisper. Install with: python -m pip install faster-whisper",
            file=sys.stderr,
        )
        sys.exit(1)

    compute_type = "int8"
    try:
        model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    except Exception as exc:
        print(f"Failed to load Whisper model '{model_name}': {exc}", file=sys.stderr)
        sys.exit(1)

    transcribe_kwargs = {}
    if language:
        transcribe_kwargs["language"] = language

    try:
        segments, _info = model.transcribe(audio_path, **transcribe_kwargs)
    except Exception as exc:
        print(f"Transcription failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    base = os.path.splitext(os.path.basename(audio_path))[0]
    safe_base = base.replace(" ", "_")

    if output_format == "srt":
        ext = ".srt"
    else:
        ext = ".json"

    output_path = os.path.join(output_dir, safe_base + ext)

    try:
        if output_format == "srt":
            _write_srt(segments, output_path)
        else:
            _write_json(segments, output_path)
    except Exception as exc:
        print(f"Failed to write transcript: {exc}", file=sys.stderr)
        sys.exit(1)

    print(output_path)


def _format_srt_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def _write_srt(segments, output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as fh:
        i = 1
        for seg in segments:
            start = _format_srt_timestamp(seg.start)
            end = _format_srt_timestamp(seg.end)
            text = seg.text.strip()
            fh.write(f"{i}\n{start} --> {end}\n{text}\n\n")
            i += 1


def _write_json(segments, output_path: str) -> None:
    import json

    data = {
        "segments": [
            {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip()}
            for seg in segments
        ]
    }
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
