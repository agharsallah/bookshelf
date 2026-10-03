"""The background runners one API process owns, started and stopped together.

The lifespan starts them; switching databases (Settings → Database) stops them, so every
running job goes back to the queue of the database it came from, and starts fresh ones
that claim from the new database.
"""

import logging
import threading

from app.core.config import Settings
from app.jobs.background import BackgroundWorker, stop_all
from app.jobs.embedded import EmbedRunner
from app.jobs.narration import NarrateRunner
from app.jobs.queue import own_slot_kinds
from app.jobs.worker import Worker, autodiscover

logger = logging.getLogger(__name__)


def _job_worker(settings: Settings) -> BackgroundWorker | None:
    """The API's own pipeline worker (`app.jobs.background`): every kind with a handler,
    except `embed` while embedded Qdrant's runner owns it, and `narrate`, which runs on a
    slot of its own (`app.jobs.narration`)."""
    if not settings.api_worker:
        return None
    autodiscover()
    worker = Worker(exclude=own_slot_kinds(settings), label="api")
    return BackgroundWorker(worker, name="job-worker")


class Runners:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self.embed: EmbedRunner | None = None
        self.narrate: NarrateRunner | None = None
        self.jobs: BackgroundWorker | None = None

    def start(self) -> None:
        settings = self._settings
        with self._lock:
            if settings.qdrant_url is None and settings.api_embed_runner:
                self.embed = EmbedRunner()
                self.embed.start()
            if settings.api_narrate_runner:
                self.narrate = NarrateRunner()
                self.narrate.start()
            self.jobs = _job_worker(settings)
            if self.jobs is not None:
                self.jobs.start()

    def stop(self) -> None:
        """Hand running jobs back to their queue; `claude` and speech runs are killed."""
        with self._lock:
            stop_all([self.jobs, self.narrate])
            if self.embed is not None:
                self.embed.stop()
            self.embed = self.narrate = self.jobs = None
