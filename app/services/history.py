"""
Saved results (history): save / list / load / delete AI runs.

All functions are synchronous (SQLAlchemy + PyMySQL); the API router calls
them through a thread pool so they never block the event loop.
"""
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import func, or_, select
from sqlalchemy.orm import defer

from app.config import SAMPLE_CRM_DIR, SAMPLE_RECORDINGS_DIR, STORAGE_DIR, save_uploads
from app.db.database import session
from app.db.models import HISTORY_MODELS, cut
from app.features import Feature

log = logging.getLogger("ihelp.history")

SAMPLE_DIRS = {"recordings": SAMPLE_RECORDINGS_DIR, "crm": SAMPLE_CRM_DIR}


def supports(slug: str) -> bool:
    return slug in HISTORY_MODELS


# ------------------------------------------------------------- file storage
def _store_upload(slug: str, filename: str | None, data: bytes) -> str:
    ext = Path(filename or "").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,9}", ext):
        ext = ".bin"
    rel = Path("uploads") / slug / datetime.now().strftime("%Y-%m") / f"{uuid.uuid4().hex}{ext}"
    full = STORAGE_DIR / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return rel.as_posix()


def _resolve_stored(rel: str | None) -> Path | None:
    """Absolute path of a stored upload, guarded against path traversal."""
    if not rel:
        return None
    root = STORAGE_DIR.resolve()
    path = (root / rel).resolve()
    if root not in path.parents or not path.is_file():
        return None
    return path


def _delete_stored(rel: str | None) -> None:
    path = _resolve_stored(rel)
    if path:
        try:
            path.unlink()
        except OSError as exc:
            log.warning("Could not delete %s: %s", path, exc)


# ------------------------------------------------------------------- CRUD
def save_run(feature: Feature, payload: dict, source: str,
             file_bytes: bytes | None, filename: str | None,
             content_type: str | None) -> dict:
    """Persist a finished run. Returns {"run_id", "created_at"}."""
    model = HISTORY_MODELS[feature.slug]
    params = {k: v for k, v in (payload.get("input") or {}).items() if k != "file"}
    data = payload.get("data") or {}

    rel = None
    if source == "upload" and file_bytes and save_uploads():
        rel = _store_upload(feature.slug, filename, file_bytes)
    try:
        with session() as db:
            row = model(
                mode=payload.get("mode", "live"),
                elapsed_ms=payload.get("elapsed_ms"),
                source=source,
                file_name=cut(filename, 255),
                file_path=rel,
                file_size=len(file_bytes) if file_bytes else None,
                content_type=cut(content_type, 100),
                params=params,
                response=data,
                **model.extract(params, data if isinstance(data, dict) else {}),
            )
            db.add(row)
            db.flush()
            return {"run_id": row.id,
                    "created_at": row.created_at.isoformat(timespec="seconds") + "Z"}
    except Exception:
        _delete_stored(rel)          # don't leave orphan files behind
        raise


def list_runs(slug: str, limit: int = 15, offset: int = 0, q: str = "") -> dict:
    model = HISTORY_MODELS[slug]
    stmt = select(model).options(defer(model.response), defer(model.params))
    q = (q or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(*(getattr(model, c).like(like) for c in model.search_columns)))
    with session() as db:
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.scalars(stmt.order_by(model.id.desc()).limit(limit).offset(offset)).all()
        return {"total": total, "items": [r.list_item() for r in rows]}


def _file_url(feature: Feature, row) -> str | None:
    if row.source == "upload" and _resolve_stored(row.file_path):
        return f"/api/features/{feature.slug}/history/{row.id}/file"
    if row.source == "sample" and row.file_name and feature.file_kind in SAMPLE_DIRS:
        if (SAMPLE_DIRS[feature.file_kind] / row.file_name).is_file():
            return f"/samples/{feature.file_kind}/{quote(row.file_name)}"
    return None


def get_run(feature: Feature, run_id: int) -> dict | None:
    """Return a saved run in the same shape as a fresh /run response."""
    model = HISTORY_MODELS[feature.slug]
    with session() as db:
        row = db.get(model, run_id)
        if row is None:
            return None
        return {
            "feature": feature.slug,
            "mode": row.mode,
            "elapsed_ms": row.elapsed_ms or 0,
            "input": {"file": row.file_name, **(row.params or {})},
            "data": row.response,
            "run_id": row.id,
            "created_at": row.created_at.isoformat(timespec="seconds") + "Z",
            "source": row.source,
            "file_url": _file_url(feature, row),
        }


def stored_file(slug: str, run_id: int) -> tuple[Path, str, str | None] | None:
    model = HISTORY_MODELS[slug]
    with session() as db:
        row = db.get(model, run_id)
        if row is None:
            return None
        path = _resolve_stored(row.file_path)
        return (path, row.file_name or path.name, row.content_type) if path else None


def delete_run(slug: str, run_id: int) -> bool:
    model = HISTORY_MODELS[slug]
    with session() as db:
        row = db.get(model, run_id)
        if row is None:
            return False
        rel = row.file_path
        db.delete(row)
    _delete_stored(rel)
    return True
