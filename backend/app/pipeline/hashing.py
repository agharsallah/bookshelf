"""Stable content hashes that make every stage idempotent (§7, §14 Idempotency).

`input_hash` covers the exact selector JSON plus the skill's name and version, so the same
inputs under the same prompt are never paid for twice, and a prompt bump re-runs exactly
the scopes it touches.
"""

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Key-sorted, whitespace-free JSON: equal values always serialize identically."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def input_hash(skill: str, skill_version: str, inputs: dict[str, Any]) -> str:
    """sha256 over the canonical inputs, the skill name and its version."""
    return _sha256(canonical_json({"skill": skill, "version": skill_version, "inputs": inputs}))


def body_hash(body: dict[str, Any]) -> str:
    """Hash for human-authored artifacts, whose "input" is the body a person wrote."""
    return _sha256(canonical_json({"origin": "human", "body": body}))
