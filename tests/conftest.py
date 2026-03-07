import pytest

from vibebot.core.db import get_connection, init_db


@pytest.fixture
def db(tmp_path):
    """A fresh in-memory SQLite DB for each test."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    return get_connection(db_path)
