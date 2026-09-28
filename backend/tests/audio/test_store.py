"""Narrations on disk: render keys, manifests beside their MP3s, and serving only those."""

import json
import os
import uuid
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from app.audio import store
from app.core.errors import NotFoundError

DOC, SCRIPT = uuid.uuid4(), str(uuid.uuid4())
ENGINE = {"model": "vibevoice-1.5b", "seed": 42}
MARK = store.Mark(start=0.0, end=1.0, section=0, title="Stocks")


def render(key: str = "k1", **fields: object) -> store.Render:
    base = store.Render(
        key=key,
        document_id=str(DOC),
        source=SCRIPT,
        voices=("alice", "frank"),
        duration=61.5,
        sections=(MARK,),
        turns=(replace(MARK, turn=0, title=None),),
        engine=ENGINE,
    )
    return replace(base, **fields)


def with_audio(audio_dir: Path, key: str = "k1") -> Path:
    path = store.audio_path(audio_dir, DOC, SCRIPT, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"ID3")
    return path


def test_render_key_depends_on_the_cast_in_order_and_the_engine_but_not_key_order():
    key = store.render_key(["alice", "frank"], ENGINE)

    assert key == store.render_key(("alice", "frank"), {"seed": 42, "model": "vibevoice-1.5b"})
    assert key != store.render_key(["frank", "alice"], ENGINE)
    assert key != store.render_key(["alice", "frank"], {**ENGINE, "seed": 7})
    assert len(key) == 16


def test_render_key_hashes_the_words_only_for_a_source_that_has_them():
    key = store.render_key(["alice"], ENGINE)

    assert store.render_key(["alice"], ENGINE, content="") == key  # summaries keep their keys
    assert store.render_key(["alice"], ENGINE, content="words-1") != key
    assert store.render_key(["alice"], ENGINE, content="words-1") != store.render_key(
        ["alice"], ENGINE, content="words-2"
    )


@pytest.mark.parametrize("source", ["", "..", "../elsewhere", "a/b", "~home", "x" * 201])
def test_a_folder_is_only_ever_a_plain_name_under_the_document(tmp_path: Path, source: str):
    with pytest.raises(ValueError, match="not a narration source"):
        store.folder(tmp_path, DOC, source)


def test_a_saved_render_is_found_again_with_its_timeline(tmp_path: Path):
    with_audio(tmp_path)

    saved = store.save(tmp_path, render())

    assert saved.created_at != ""
    assert store.find(tmp_path, DOC, SCRIPT, "k1") == saved
    assert saved.file == f"{DOC}/{SCRIPT}/k1.mp3"
    assert list(tmp_path.rglob("*.part")) == []


def test_a_manifest_is_never_written_without_its_audio(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        store.save(tmp_path, render())

    assert store.list_renders(tmp_path, DOC) == []


def test_a_render_whose_audio_is_gone_is_not_found(tmp_path: Path):
    audio = with_audio(tmp_path)
    store.save(tmp_path, render())
    audio.unlink()

    assert store.find(tmp_path, DOC, SCRIPT, "k1") is None


def write_manifest(audio_dir: Path, key: str, created_at: str) -> None:
    with_audio(audio_dir, key)
    manifest = store.folder(audio_dir, DOC, SCRIPT) / f"{key}.json"
    manifest.write_text(json.dumps(asdict(render(key, created_at=created_at))))


def test_list_renders_is_newest_first_and_ignores_torn_or_orphan_manifests(tmp_path: Path):
    write_manifest(tmp_path, "old", "2026-09-01T10:00:00+00:00")
    write_manifest(tmp_path, "new", "2026-09-20T10:00:00+00:00")
    folder = store.folder(tmp_path, DOC, SCRIPT)
    (folder / "torn.json").write_text('{"key": "torn", "voi')
    (folder / "torn.mp3").write_bytes(b"ID3")
    (folder / "orphan.json").write_text(json.dumps(asdict(render("orphan"))))  # no mp3

    listed = store.list_renders(tmp_path, DOC)

    assert [r.key for r in listed] == ["new", "old"]
    assert store.find(tmp_path, DOC, SCRIPT, "torn") is None
    assert store.list_renders(tmp_path, uuid.uuid4()) == []


def test_renders_list_per_source_and_carry_the_words_they_voiced(tmp_path: Path):
    with_audio(tmp_path)
    store.save(tmp_path, render())
    reading = "read~ch01"
    audio = store.audio_path(tmp_path, DOC, reading, "r1")
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"ID3")
    store.save(tmp_path, render("r1", source=reading, voices=("alice",), content="words-1"))

    (listed,) = store.list_renders(tmp_path, DOC, reading)

    assert (listed.key, listed.content, listed.file) == ("r1", "words-1", f"{DOC}/{reading}/r1.mp3")
    assert {r.key for r in store.list_renders(tmp_path, DOC)} == {"k1", "r1"}
    assert store.list_renders(tmp_path, DOC, "read~ch02") == []


def test_a_manifest_from_before_sources_still_loads_as_its_scripts_render(tmp_path: Path):
    with_audio(tmp_path)
    legacy = {k: v for k, v in asdict(render()).items() if k not in ("source", "content")}
    manifest = store.folder(tmp_path, DOC, SCRIPT) / "k1.json"
    manifest.write_text(json.dumps({**legacy, "artifact_id": SCRIPT}))

    found = store.find(tmp_path, DOC, SCRIPT, "k1")

    assert found is not None
    assert (found.source, found.content) == (SCRIPT, "")


def test_remove_document_deletes_only_that_documents_narrations(tmp_path: Path):
    with_audio(tmp_path)
    other = uuid.uuid4()
    kept = store.audio_path(tmp_path, other, SCRIPT, "k1")
    kept.parent.mkdir(parents=True)
    kept.write_bytes(b"ID3")

    assert store.remove_document(tmp_path, DOC) is True
    assert store.remove_document(tmp_path, DOC) is False
    assert not (tmp_path / str(DOC)).exists()
    assert kept.is_file()


def test_resolve_file_serves_an_mp3_inside_the_audio_folder(tmp_path: Path):
    path = with_audio(tmp_path)

    assert store.resolve_file(tmp_path, f"{DOC}/{SCRIPT}/k1.mp3") == (path.resolve(), "audio/mpeg")


@pytest.mark.parametrize(
    "raw",
    [
        "../secret.mp3",
        f"{DOC}/../../secret.mp3",
        "/etc/passwd",
        "link.mp3",
        f"{DOC}/{SCRIPT}/k1.json",
        f"{DOC}/{SCRIPT}",
        "missing.mp3",
        "bad\x00.mp3",
        "",
    ],
    ids=[
        "dotdot",
        "nested-dotdot",
        "absolute",
        "symlink-escape",
        "manifest",
        "directory",
        "missing",
        "nul",
        "empty",
    ],
)
def test_resolve_file_refuses_anything_else_as_not_found(tmp_path: Path, raw: str):
    audio_dir = tmp_path / "audio"
    with_audio(audio_dir)
    (store.folder(audio_dir, DOC, SCRIPT) / "k1.json").write_text("{}")
    secret = tmp_path / "secret.mp3"
    secret.write_bytes(b"ID3 secret")
    os.symlink(secret, audio_dir / "link.mp3")

    with pytest.raises(NotFoundError):
        store.resolve_file(audio_dir, raw)
