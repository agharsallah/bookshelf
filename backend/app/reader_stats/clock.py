"""Local time: which day and hour a UTC timestamp falls on, in the reader's time zone."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def zone(name: str) -> ZoneInfo:
    """The IANA zone `name`; raises ValueError for an unknown one."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"Unknown time zone {name!r}.") from exc


@dataclass(frozen=True, slots=True)
class Clock:
    tz: ZoneInfo
    now: datetime

    def local(self, at: datetime) -> datetime:
        return at.astimezone(self.tz)

    def day(self, at: datetime) -> date:
        return self.local(at).date()

    @property
    def today(self) -> date:
        return self.day(self.now)

    def since(self, days: int | None) -> datetime:
        """Local midnight `days - 1` days before today (so `days=1` is today), or the epoch."""
        if days is None:
            return EPOCH
        start = self.today - timedelta(days=days - 1)
        return datetime.combine(start, datetime.min.time(), tzinfo=self.tz).astimezone(UTC)

    def days_ago(self, at: datetime) -> int:
        return (self.today - self.day(at)).days
