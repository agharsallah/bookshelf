"""`prune_document_media`: stale crops go, referenced ones and other documents' stay."""

from pathlib import Path

from app.services.media import prune_document_media


def crop(media: Path, relative: str) -> Path:
    path = media / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"png")
    return path


def test_only_unreferenced_files_of_the_document_are_deleted(tmp_path: Path):
    kept = crop(tmp_path, "book/ch01/f001.png")
    crop(tmp_path, "book/ch02/f001.png")
    neighbour = crop(tmp_path, "book-two/ch02/f001.png")

    deleted = prune_document_media(tmp_path, "book", ["book/ch01/f001.png"])

    assert deleted == ["book/ch02/f001.png"]
    assert kept.exists() and neighbour.exists()
    assert not (tmp_path / "book" / "ch02").exists()


def test_a_slug_that_escapes_the_media_dir_deletes_nothing(tmp_path: Path):
    outside = crop(tmp_path, "elsewhere/x.png")

    assert prune_document_media(tmp_path / "media", "../elsewhere", []) == []
    assert outside.exists()
