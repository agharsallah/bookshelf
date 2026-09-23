"""Figure media: images inside media_dir only, cacheable, embeddable cross-origin."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.api.factories import write_file

URL = "/api/v1/media"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


def test_serves_an_image_with_long_caching_and_cross_origin_policy(
    client: TestClient, media_dir: Path
):
    write_file(media_dir, "book/ch01-f001.png", PNG)

    response = client.get(f"{URL}/book/ch01-f001.png")

    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert "max-age=31536000" in response.headers["cache-control"]
    assert response.headers["cross-origin-resource-policy"] == "cross-origin"
    assert "img-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    "path",
    [
        "..%2Fsecret.png",
        "book/..%2F..%2Fsecret.png",
        "%2Fetc%2Fpasswd",
        "notes.txt",
        "book",
        "missing.png",
        "link.png",
    ],
    ids=[
        "dotdot",
        "nested-dotdot",
        "absolute",
        "not-an-image",
        "directory",
        "missing",
        "symlink-escape",
    ],
)
def test_anything_but_an_image_inside_media_is_404(client: TestClient, media_dir: Path, path: str):
    secret = write_file(media_dir.parent, "secret.png", PNG)
    write_file(media_dir, "notes.txt", b"text")
    write_file(media_dir, "book/ok.png", PNG)
    os.symlink(secret, media_dir / "link.png")

    response = client.get(f"{URL}/{path}")

    assert response.status_code == 404
