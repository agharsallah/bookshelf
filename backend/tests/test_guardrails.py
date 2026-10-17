"""The guardrails themselves: auth, limits, headers, error shape."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import AUTH

JOB = {"kind": "export"}


def test_write_without_api_key_is_401(client: TestClient):
    response = client.post("/api/v1/jobs", json=JOB)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_write_with_wrong_api_key_is_401(client: TestClient):
    response = client.post("/api/v1/jobs", json=JOB, headers={"X-API-Key": "nope"})

    assert response.status_code == 401


def test_reads_stay_open(client: TestClient):
    assert client.get("/api/v1/jobs").status_code == 200


def test_unknown_field_is_rejected(client: TestClient):
    response = client.post(
        "/api/v1/jobs",
        json={**JOB, "sneaky": "value"},
        headers=AUTH,
    )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert any("sneaky" in detail["field"] for detail in details)


def test_page_size_is_capped(client: TestClient):
    response = client.get("/api/v1/jobs", params={"limit": 5000})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_oversized_body_is_413(client: TestClient):
    payload = {"kind": "export", "anchor": "x" * 5_000_000}

    response = client.post("/api/v1/jobs", json=payload, headers=AUTH)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("get", "/api/v1/documents", {"params": {"q": "stock\x00flow"}}),
        ("get", "/api/v1/documents/%00", {}),
        ("post", "/api/v1/search", {"json": {"query": "a\x00b", "mode": "lexical"}}),
        ("post", "/api/v1/concepts", {"json": {"canonical": "a\x00b"}, "headers": AUTH}),
        ("post", "/api/v1/jobs", {"json": {"kind": "export", "anchor": "a\x00"}, "headers": AUTH}),
    ],
)
def test_text_postgres_cannot_store_is_a_422_not_a_500(method: str, path: str, kwargs: dict):
    """NUL characters (and `\\u0000` in JSON) cannot enter Postgres text or JSONB."""
    from app.main import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as lenient:
        response = lenient.request(method, path, **kwargs)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_security_headers_and_request_id(client: TestClient):
    response = client.get("/api/v1/jobs")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-request-id"]


def test_request_id_is_echoed_when_sane(client: TestClient):
    response = client.get("/api/v1/jobs", headers={"X-Request-ID": "abc12345"})

    assert response.headers["x-request-id"] == "abc12345"


def test_forged_request_id_is_replaced(client: TestClient):
    response = client.get("/api/v1/jobs", headers={"X-Request-ID": "bad id\nINJECTED"})

    assert response.headers["x-request-id"] != "bad id\nINJECTED"


def test_health_and_readiness(client: TestClient):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/health/ready").json()["database"] == "ok"


def test_docs_are_served_outside_production(client: TestClient):
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Bookshelf API"
    assert "/api/v1/jobs" in schema["paths"]


def test_rate_limit_returns_429_with_retry_after():
    """A dedicated app instance, so the shared limiter is not polluted by other tests."""
    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        environment="test",  # type: ignore[arg-type]
        rate_limit_requests=3,
        rate_limit_window_seconds=60,
        api_key="test-secret-key",
        log_json=False,
    )
    with TestClient(create_app(settings)) as limited:
        statuses = [limited.get("/api/v1/jobs").status_code for _ in range(5)]

    assert statuses[:3] == [200, 200, 200]
    assert statuses[-1] == 429


def _limited_app(max_requests: int, proxy_hops: int = 0) -> TestClient:
    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        environment="test",  # type: ignore[arg-type]
        rate_limit_requests=max_requests,
        rate_limit_window_seconds=60,
        rate_limit_proxy_hops=proxy_hops,
        api_key="test-secret-key",
        log_json=False,
    )
    return TestClient(create_app(settings))


def test_a_new_bogus_api_key_per_request_does_not_escape_the_rate_limit():
    """Only the real key gets its own bucket; any other value counts against the caller's
    address, or rotating a junk header would buy unlimited requests (and key guesses)."""
    with _limited_app(3) as limited:
        statuses = [
            limited.get("/api/v1/jobs", headers={"X-API-Key": f"guess-{n}"}).status_code
            for n in range(5)
        ]

    assert statuses == [200, 200, 200, 429, 429]


def test_the_real_api_key_has_a_bucket_of_its_own():
    with _limited_app(2) as limited:
        anonymous = [limited.get("/api/v1/jobs").status_code for _ in range(3)]
        keyed = [limited.get("/api/v1/jobs", headers=AUTH).status_code for _ in range(2)]

    assert (anonymous, keyed) == ([200, 200, 429], [200, 200])


def test_a_forged_forwarded_for_per_request_does_not_escape_the_rate_limit():
    """Behind one appending proxy only the rightmost entry is the proxy's; a client that
    writes a fresh address on the left each time still lands in its own bucket."""
    with _limited_app(2, proxy_hops=1) as limited:
        statuses = [
            limited.get(
                "/api/v1/jobs", headers={"X-Forwarded-For": f"10.0.0.{n}, 203.0.113.7"}
            ).status_code
            for n in range(4)
        ]

    assert statuses == [200, 200, 429, 429]


def test_behind_a_proxy_each_real_client_has_its_own_bucket():
    with _limited_app(1, proxy_hops=1) as limited:
        statuses = [
            limited.get("/api/v1/jobs", headers={"X-Forwarded-For": f"203.0.113.{n}"}).status_code
            for n in range(3)
        ]

    assert statuses == [200, 200, 200]


def test_an_unhandled_error_keeps_the_request_id_in_envelope_and_header():
    """Starlette answers unhandled exceptions outside the request-context middleware; the
    envelope used to say `request_id: "-"`."""
    from app.main import create_app

    app = create_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("kaput")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/boom", headers={"X-Request-ID": "trace12345"})

    assert response.status_code == 500
    assert response.json()["error"]["request_id"] == "trace12345"
    assert response.headers["x-request-id"] == "trace12345"
    assert "kaput" not in response.text
