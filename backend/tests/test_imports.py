"""Heavy native stacks load only when used: the API and the worker start without them.

`qdrant_client` imports fastembed and onnxruntime at import time (~1 s, and a native
runtime that has aborted the interpreter at exit), so the API reaches Qdrant lazily: on
the first search or embed job. Runs in a fresh interpreter, since this test process has
long imported everything.
"""

import subprocess
import sys

PROBE = """
import sys
import app.main
from app.jobs.worker import autodiscover
autodiscover()
print(",".join(m for m in ("qdrant_client", "fastembed", "onnxruntime") if m in sys.modules))
"""


def test_api_and_worker_start_without_loading_qdrant_or_onnxruntime():
    probe = subprocess.run(  # noqa: S603  (fixed argv, no input)
        [sys.executable, "-c", PROBE], capture_output=True, text=True, check=True, timeout=60
    )

    assert probe.stdout.strip() == ""
