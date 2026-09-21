"""Importing this package registers every table with `SQLModel.metadata`."""

from app.models.book import Book, ReadingStatus

__all__ = ["Book", "ReadingStatus"]
