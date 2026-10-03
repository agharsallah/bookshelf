"""Which database the app reads and writes: the local cluster or the main (Supabase) one.

Two URLs are configured (`Settings.local_database_url`, `Settings.database_url`). The choice
between them is not an environment variable but a one-word file (`database_target_file`),
so Settings → Database can flip it at runtime and a restart keeps it. Without the file the
main database is used, as before this existed. Tests always use `database_url`.
"""

from enum import StrEnum
from urllib.parse import urlsplit

from app.core.config import Environment, Settings


class DatabaseTarget(StrEnum):
    LOCAL = "local"
    REMOTE = "remote"


def url_for(settings: Settings, target: DatabaseTarget) -> str:
    return settings.local_database_url if target is DatabaseTarget.LOCAL else settings.database_url


def has_two(settings: Settings) -> bool:
    """Switching and syncing need two different databases (and never run under tests)."""
    return (
        settings.environment is not Environment.TEST
        and settings.local_database_url != settings.database_url
    )


def stored_target(settings: Settings) -> DatabaseTarget:
    """The saved choice; the main database when nothing (or nothing valid) is saved."""
    if not has_two(settings):
        return DatabaseTarget.REMOTE
    try:
        return DatabaseTarget(settings.database_target_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return DatabaseTarget.REMOTE


def save_target(settings: Settings, target: DatabaseTarget) -> None:
    settings.database_target_file.write_text(f"{target.value}\n", encoding="utf-8")


def other(target: DatabaseTarget) -> DatabaseTarget:
    return DatabaseTarget.REMOTE if target is DatabaseTarget.LOCAL else DatabaseTarget.LOCAL


def label(settings: Settings, target: DatabaseTarget) -> str:
    """How the settings page names a database."""
    if target is DatabaseTarget.LOCAL:
        return "This computer"
    return "Supabase" if "supabase" in host(url_for(settings, target)) else "Main database"


def host(url: str) -> str:
    """`host:port/name`, without the user or password: safe to show and to log."""
    parts = urlsplit(url)
    where = parts.hostname or "localhost"
    if parts.port:
        where = f"{where}:{parts.port}"
    return f"{where}{parts.path}"
