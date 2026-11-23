"""Application settings loaded from environment / .env file.

API URLs/keys and FORCE_DEMO_MODE are re-read from .env whenever the file
changes, so connecting a new API doesn't require restarting the server.
"""
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
ENV_FILE = BASE_DIR / ".env"

_REAL_ENV = dict(os.environ)   # snapshot before .env is merged in
load_dotenv(ENV_FILE)


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


APP_NAME = os.getenv("APP_NAME", "iHelp AI Showcase")
COMPANY_NAME = os.getenv("COMPANY_NAME", "iHelp")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
API_TIMEOUT = float(os.getenv("API_TIMEOUT", "180"))

# Sample data folders (served to the browser so clients can pick a sample)
SAMPLE_RECORDINGS_DIR = BASE_DIR / "sample-call-recordings"
SAMPLE_CRM_DIR = BASE_DIR / "sample-crm-datas"

# Uploaded files that belong to saved results (history) live here
STORAGE_DIR = Path(os.getenv("STORAGE_DIR") or BASE_DIR / "storage")

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".aac"}
CRM_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json"}

# ------------------------------------------------------------ live settings
_cache: dict = {"mtime": None, "values": {}}


def _live_env() -> dict:
    """Current .env values (reloaded when the file's mtime changes)."""
    try:
        mtime = ENV_FILE.stat().st_mtime
    except FileNotFoundError:
        mtime = None
    if mtime != _cache["mtime"]:
        _cache["values"] = dotenv_values(ENV_FILE) if mtime else {}
        _cache["mtime"] = mtime
    return _cache["values"]


def get_setting(name: str, default: str = "") -> str:
    """Real environment variables win over .env (useful for deployments)."""
    if name in _REAL_ENV:
        return _REAL_ENV[name]
    value = _live_env().get(name)
    return default if value is None else value


def force_demo_mode() -> bool:
    return _truthy(get_setting("FORCE_DEMO_MODE", "false"))


def db_settings() -> dict:
    """MySQL connection settings (live, so fixing .env needs no restart)."""
    return {
        "enabled": _truthy(get_setting("DB_ENABLED", "true")),
        "host": get_setting("DB_HOST", "127.0.0.1").strip(),
        "port": int(get_setting("DB_PORT", "3306").strip() or 3306),
        "user": get_setting("DB_USER", "root").strip(),
        "password": get_setting("DB_PASSWORD", ""),
        "name": get_setting("DB_NAME", "ihelp_ai_demo").strip(),
    }


def save_uploads() -> bool:
    """Keep a copy of uploaded files so saved results can replay the audio."""
    return _truthy(get_setting("SAVE_UPLOADS", "true"))


def api_settings(env_prefix: str) -> dict:
    """Return the upstream URL / key for a feature, e.g. prefix 'CALL_ANALYSIS'."""
    return {
        "url": get_setting(f"{env_prefix}_API_URL").strip(),
        "key": get_setting(f"{env_prefix}_API_KEY").strip(),
    }
