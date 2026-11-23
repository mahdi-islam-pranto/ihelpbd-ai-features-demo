"""
MySQL connection handling.

On first use the app creates the database (DB_NAME) and every table that
doesn't exist yet, so a fresh MySQL server needs no manual setup.

If MySQL is unreachable the portal keeps working - results just aren't
saved - and the connection is retried automatically (every RETRY_SECONDS,
or immediately after the DB_* values in .env change).
"""
import logging
import re
import threading
import time
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import db_settings

log = logging.getLogger("ihelp.db")
RETRY_SECONDS = 15


class DatabaseUnavailable(Exception):
    pass


class _State:
    engine: Engine | None = None
    factory: sessionmaker | None = None
    error: str | None = "Not connected yet"
    signature: tuple | None = None
    last_attempt: float = 0.0


_state = _State()
_lock = threading.Lock()


def _url(s: dict, with_db: bool = True) -> URL:
    return URL.create(
        "mysql+pymysql",
        username=s["user"],
        password=s["password"] or None,
        host=s["host"],
        port=s["port"],
        database=s["name"] if with_db else None,
        query={"charset": "utf8mb4"},
    )


def _friendly(exc: Exception) -> str:
    orig = getattr(exc, "orig", None)
    args = getattr(orig, "args", None)
    if args and len(args) >= 2:
        return f"MySQL error {args[0]}: {args[1]}"
    return str(exc).splitlines()[0][:240]


def _connect(s: dict) -> Engine:
    if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", s["name"]):
        raise ValueError("DB_NAME may only contain letters, digits and underscores")

    # 1) Create the database if it doesn't exist (needs CREATE privilege;
    #    if the user lacks it we still try to use an existing database).
    server = create_engine(_url(s, with_db=False), pool_pre_ping=True)
    try:
        with server.begin() as conn:
            conn.execute(text(
                f"CREATE DATABASE IF NOT EXISTS `{s['name']}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not create database %s: %s", s["name"], _friendly(exc))
    finally:
        server.dispose()

    # 2) Connect to it and create missing tables.
    engine = create_engine(_url(s), pool_pre_ping=True, pool_recycle=3600,
                           pool_size=5, max_overflow=10)
    from app.db.models import Base  # local import avoids a cycle
    Base.metadata.create_all(engine)
    return engine


def ensure_db() -> bool:
    """Connect (or reconnect) if needed. Returns True when the DB is usable."""
    s = db_settings()
    if not s["enabled"]:
        _state.error = "Database is disabled (DB_ENABLED=false in .env)."
        return False
    sig = tuple(sorted(s.items()))
    if _state.engine is not None and sig == _state.signature:
        return True

    with _lock:
        if _state.engine is not None and sig == _state.signature:
            return True
        now = time.monotonic()
        if sig == _state.signature and now - _state.last_attempt < RETRY_SECONDS:
            return False                       # failed recently with same settings
        _state.signature, _state.last_attempt = sig, now
        if _state.engine is not None:
            _state.engine.dispose()
            _state.engine = _state.factory = None
        try:
            engine = _connect(s)
        except Exception as exc:  # noqa: BLE001
            _state.error = _friendly(exc)
            log.warning("Database unavailable: %s", _state.error)
            return False
        _state.engine = engine
        _state.factory = sessionmaker(engine, expire_on_commit=False)
        _state.error = None
        log.info("Connected to MySQL database '%s' on %s:%s", s["name"], s["host"], s["port"])
        return True


def status() -> dict:
    ok = ensure_db()
    s = db_settings()
    return {"connected": ok, "database": s["name"], "host": f"{s['host']}:{s['port']}",
            "error": None if ok else _state.error}


def last_error() -> str:
    return _state.error or "Database unavailable"


@contextmanager
def session() -> Session:
    if not ensure_db():
        raise DatabaseUnavailable(last_error())
    db = _state.factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
