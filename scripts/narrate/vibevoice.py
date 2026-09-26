# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "torch>=2.8",
#   "transformers>=5.17",
#   "diffusers>=0.35",
#   "accelerate>=1.10",
#   "librosa>=0.11",
#   "soundfile>=0.13",
#   "numpy>=2",
# ]
# ///
"""Voice a script with VibeVoice (https://huggingface.co/microsoft/VibeVoice-1.5B).

Run by the backend's `narrate` job (backend/app/audio/runner.py) as

    uv run --script scripts/narrate/vibevoice.py < request.json

in an environment of its own: uv installs torch and transformers for this script alone,
on a Python they support, so the API never imports them. The request:

    {"title", "voices": [wav path per speaker], "sections": [{"title", "turns":
     [{"speaker": 0-based index, "text"}]}], "out": "<file>.mp3", "model",
     "diffusion_steps", "guidance_scale", "seed", "device": auto|cuda|mps|cpu}

Each section is generated as one multi-speaker conversation, so turn-taking, reactions
and tone follow the dialogue the way VibeVoice was trained to (up to four speakers, long
form, each voice cloned from its reference clip). Voices stay the same across sections
because every section is conditioned on the same clips and seed. Sections are joined with
short pauses, levelled, and written as MP3. Progress goes to stderr as JSON lines; the
result is one JSON line on stdout:

    {"duration", "sections": [{start, end, section, title}],
     "turns": [{start, end, section, turn}], "engine": {...}}

Turn times are estimates (each turn's share of its section's characters); section times
are exact.

Each finished section is kept in `<out>.parts/` until the MP3 is written, so a run that is
killed part way (the API reloading, a restart) picks up at the section it was on instead
of starting over. A part is keyed by its words, voices and engine settings, so a changed
request never reuses a stale one.
"""

import hashlib
import json
import math
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModelForTextToWaveform, AutoProcessor, set_seed

SAMPLE_RATE = 24_000
TOKENS_PER_SECOND = 7.5  # the acoustic tokenizer's frame rate
LEAD_IN, GAP, TAIL = 0.4, 0.9, 1.2  # seconds of silence: start, between sections, end
TARGET_RMS, PEAK = 0.1, 0.95  # about -20 dBFS speech, with headroom


def log(**event: Any) -> None:
    print(json.dumps(event), file=sys.stderr, flush=True)


def pick_device(requested: str) -> tuple[str, torch.dtype]:
    """CUDA in bf16; Apple GPUs in fp16 (M1/M2 have no fast bf16); CPU in fp32."""
    device = requested
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = {"cuda": torch.bfloat16, "mps": torch.float16}.get(device, torch.float32)
    return device, dtype


def conversation(section: dict[str, Any], voices: list[str]) -> list[dict[str, Any]]:
    """One section as a chat: a speaker's reference clip goes with their first turn."""
    seen: set[int] = set()
    turns = []
    for turn in section["turns"]:
        content: list[dict[str, str]] = [{"type": "text", "text": turn["text"]}]
        if turn["speaker"] not in seen:
            seen.add(turn["speaker"])
            content.append({"type": "audio", "url": voices[turn["speaker"]]})  # a local path works too
        turns.append({"role": str(turn["speaker"]), "content": content})
    return turns


def as_array(audio: Any) -> np.ndarray:
    item = audio[0] if isinstance(audio, (list, tuple)) else audio
    if isinstance(item, dict):
        item = item.get("audio", item.get("waveform"))
    if isinstance(item, torch.Tensor):
        item = item.detach().float().cpu().numpy()
    return np.asarray(item, dtype=np.float32).reshape(-1)


def token_budget(section: dict[str, Any]) -> int:
    """Enough acoustic tokens for the section at a slow pace, so it never runs away."""
    words = sum(len(turn["text"].split()) + len(turn["text"]) // 6 for turn in section["turns"])
    return int(words / 2.0 * TOKENS_PER_SECOND * 1.5) + 150


def level(audio: np.ndarray) -> np.ndarray:
    rms = float(np.sqrt(np.mean(audio**2))) if audio.size else 0.0
    if rms > 0:
        audio = audio * (TARGET_RMS / rms)
    peak = float(np.abs(audio).max()) if audio.size else 0.0
    return audio * (PEAK / peak) if peak > PEAK else audio


def fade(audio: np.ndarray, seconds: float = 0.02) -> np.ndarray:
    n = min(int(SAMPLE_RATE * seconds), audio.size // 2)
    if n > 0:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        audio[:n] *= ramp
        audio[-n:] *= ramp[::-1]
    return audio


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def turn_marks(section: dict[str, Any], index: int, start: float, length: float) -> list[dict[str, Any]]:
    weights = [max(len(turn["text"]), 1) for turn in section["turns"]]
    total, clock, marks = sum(weights), start, []
    for number, weight in enumerate(weights):
        span = length * weight / total
        marks.append({"start": round(clock, 2), "end": round(clock + span, 2), "section": index, "turn": number})
        clock += span
    return marks


def part_path(parts_dir: Path, request: dict[str, Any], section: dict[str, Any], dtype: torch.dtype) -> Path:
    """Where a finished section is kept: named by everything that shapes its sound."""
    engine = {k: request.get(k) for k in ("model", "diffusion_steps", "guidance_scale", "seed")}
    key = json.dumps({"section": section, "voices": request["voices"], "engine": engine, "dtype": str(dtype)}, sort_keys=True)
    return parts_dir / f"{hashlib.sha256(key.encode()).hexdigest()[:20]}.wav"


class Voicer:
    """The model, loaded only when a section is not already on disk."""

    def __init__(self, request: dict[str, Any], device: str, dtype: torch.dtype) -> None:
        self.request, self.device, self.dtype = request, device, dtype
        self._model: Any = None
        self._processor: Any = None

    def voice(self, section: dict[str, Any]) -> np.ndarray:
        if self._model is None:
            log(event="loading", model=self.request["model"], device=self.device, dtype=str(self.dtype))
            self._processor = AutoProcessor.from_pretrained(self.request["model"])
            model = AutoModelForTextToWaveform.from_pretrained(self.request["model"], dtype=self.dtype)
            self._model = model.to(self.device).eval()
        set_seed(int(self.request.get("seed", 42)))
        inputs = self._processor.apply_chat_template(
            conversation(section, self.request["voices"]), tokenize=True, return_dict=True, add_generation_prompt=True
        ).to(self.device, self.dtype)
        with torch.inference_mode():
            audio = self._model.generate(
                **inputs,
                max_new_tokens=token_budget(section),
                guidance_scale=float(self.request.get("guidance_scale", 1.3)),
                num_diffusion_steps=int(self.request.get("diffusion_steps", 10)),
            )
        if self.device == "mps":
            torch.mps.empty_cache()
        return fade(level(as_array(audio)))


def main() -> int:
    request = json.load(sys.stdin)
    device, dtype = pick_device(request.get("device", "auto"))
    started = time.monotonic()
    voicer = Voicer(request, device, dtype)
    parts_dir = Path(request["out"] + ".parts")
    parts_dir.mkdir(parents=True, exist_ok=True)

    sections = request["sections"]
    parts, section_marks, turns = [silence(LEAD_IN)], [], []
    clock = LEAD_IN
    for index, section in enumerate(sections):
        cached = part_path(parts_dir, request, section, dtype)
        if cached.is_file():
            log(event="section", index=index, total=len(sections), title=section["title"], cached=True)
            voiced = sf.read(cached, dtype="float32")[0]
        else:
            log(event="section", index=index, total=len(sections), title=section["title"])
            voiced = voicer.voice(section)
            if voiced.size and math.isfinite(float(voiced.sum())):
                partial = cached.with_suffix(".tmp")
                sf.write(partial, voiced, SAMPLE_RATE, format="WAV", subtype="FLOAT")
                partial.replace(cached)  # atomic: a killed write never passes for a part
        if not voiced.size or not math.isfinite(float(voiced.sum())):
            raise RuntimeError(f"section {index} produced no usable audio")
        length = voiced.size / SAMPLE_RATE
        section_marks.append({"start": round(clock, 2), "end": round(clock + length, 2), "section": index, "title": section["title"]})
        turns.extend(turn_marks(section, index, clock, length))
        parts.append(voiced)
        clock += length
        if index < len(sections) - 1:
            parts.append(silence(GAP))
            clock += GAP
    parts.append(silence(TAIL))
    track = np.concatenate(parts)

    partial = request["out"] + ".tmp"
    sf.write(partial, track, SAMPLE_RATE, format="MP3", subtype="MPEG_LAYER_III")
    Path(partial).replace(request["out"])
    shutil.rmtree(parts_dir, ignore_errors=True)
    print(
        json.dumps(
            {
                "duration": round(track.size / SAMPLE_RATE, 2),
                "sections": section_marks,
                "turns": turns,
                "engine": {"device": device, "dtype": str(dtype).removeprefix("torch."), "seconds": round(time.monotonic() - started)},
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
