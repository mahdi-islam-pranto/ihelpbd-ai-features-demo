"""
Saved results (history): save / list / load / delete AI runs.

All functions are synchronous (SQLAlchemy + PyMySQL); the API router calls
them through a thread pool so they never block the event loop.
"""
import logging
import re
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import func, or_, select
from sqlalchemy.orm import defer

from app.config import SAMPLE_CRM_DIR, SAMPLE_RECORDINGS_DIR, STORAGE_DIR, save_uploads
from app.db.database import session
from app.db.models import HISTORY_MODELS, cut, utcnow
from app.features import Feature
from app.services import leads as lead_batch

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

    if not filename and isinstance(data, dict) and data.get("file_name"):
        filename = str(data["file_name"])

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


# Chunks of one batch can arrive at the same time; merging is read-modify-write.
_batch_lock = threading.Lock()


def save_batch(feature: Feature, payload: dict, sources: list[dict], offset: int,
               planned: int, append_to: int | None) -> dict:
    """Merge one chunk of a batch run into its saved row (creating it on the first chunk).

    sources: one dict per call in the chunk, in order:
      {"kind": "upload"|"sample"|"url", "name", "url"?, "bytes"?, "content_type"?}
    """
    model = HISTORY_MODELS[feature.slug]
    params = {k: v for k, v in (payload.get("input") or {}).items() if k != "file"}
    chunk = payload.get("data") or {}

    entries, new_files = {}, []
    for i, src in enumerate(sources):
        entry = {"kind": src["kind"], "name": cut(src.get("name"), 255)}
        if src["kind"] == "url":
            entry["url"] = src["url"]
        elif src["kind"] == "upload" and src.get("bytes") and save_uploads():
            entry["path"] = _store_upload(feature.slug, src.get("name"), src["bytes"])
            entry["size"] = len(src["bytes"])
            entry["content_type"] = cut(src.get("content_type"), 100)
            new_files.append(entry["path"])
        entries[str(offset + i)] = entry

    try:
        with _batch_lock, session() as db:
            row = db.get(model, append_to) if append_to else None
            if row is None:
                # created_at = when the batch started (this first chunk took elapsed_ms)
                started = utcnow() - timedelta(milliseconds=payload.get("elapsed_ms") or 0)
                row = model(mode=payload.get("mode", "live"), source="none", params=params, sources={},
                            created_at=started)
                db.add(row)
            all_sources = {**(row.sources or {}), **entries}
            merged = lead_batch.merge(row.response, chunk)
            kinds = {e["kind"] for e in all_sources.values()}
            first = all_sources.get("0") or next(iter(all_sources.values()), {})

            row.sources = all_sources                      # new objects -> SQLAlchemy sees the change
            row.response = merged
            row.source = kinds.pop() if len(kinds) == 1 else "mixed"
            row.file_name = cut(first.get("name"), 255)
            row.planned_calls = max(planned, len(merged["results"]))
            if payload.get("mode") == "live":
                row.mode = "live"
            now = utcnow()
            row.updated_at = now
            row.elapsed_ms = int(((now - row.created_at).total_seconds() * 1000) if row.created_at
                                 else payload.get("elapsed_ms") or 0)
            # criteria come from the first chunk (the browser sends the same ones each time)
            for key, value in model.extract(row.params or params, merged).items():
                setattr(row, key, value)
            db.flush()
            return {"run_id": row.id,
                    "created_at": row.created_at.isoformat(timespec="seconds") + "Z"}
    except Exception:
        for rel in new_files:
            _delete_stored(rel)
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
    if row.source == "url":
        return (row.params or {}).get("audio_url")
    if row.source == "upload" and _resolve_stored(row.file_path):
        return f"/api/features/{feature.slug}/history/{row.id}/file"
    if row.source == "sample" and row.file_name and feature.file_kind in SAMPLE_DIRS:
        if (SAMPLE_DIRS[feature.file_kind] / row.file_name).is_file():
            return f"/samples/{feature.file_kind}/{quote(row.file_name)}"
    return None


def _sources(feature: Feature, row) -> list[dict]:
    """Per-call sources of a batch row, with a playable URL for each."""
    out = []
    for key, src in sorted((row.sources or {}).items(), key=lambda kv: int(kv[0])):
        url = None
        if src.get("kind") == "url":
            url = src.get("url")
        elif src.get("kind") == "upload" and _resolve_stored(src.get("path")):
            url = f"/api/features/{feature.slug}/history/{row.id}/file?i={key}"
        elif src.get("kind") == "sample" and src.get("name") and feature.file_kind in SAMPLE_DIRS:
            if (SAMPLE_DIRS[feature.file_kind] / src["name"]).is_file():
                url = f"/samples/{feature.file_kind}/{quote(src['name'])}"
        out.append({"index": int(key), "kind": src.get("kind"), "name": src.get("name"),
                    "url": url, "stored": bool(url)})
    return out


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
            **({"sources": _sources(feature, row), "planned": row.planned_calls}
               if hasattr(row, "sources") else {}),
        }


def stored_file(slug: str, run_id: int, index: int | None = None) -> tuple[Path, str, str | None] | None:
    """The stored upload of a run (batch runs: the upload of call number `index`)."""
    model = HISTORY_MODELS[slug]
    with session() as db:
        row = db.get(model, run_id)
        if row is None:
            return None
        if index is not None and hasattr(row, "stored_path"):
            rel, name = row.stored_path(index)
            path = _resolve_stored(rel)
            return (path, name or path.name, None) if path else None
        path = _resolve_stored(row.file_path)
        return (path, row.file_name or path.name, row.content_type) if path else None


def delete_run(slug: str, run_id: int) -> bool:
    model = HISTORY_MODELS[slug]
    with session() as db:
        row = db.get(model, run_id)
        if row is None:
            return False
        paths = [row.file_path, *(row.stored_paths() if hasattr(row, "stored_paths") else [])]
        db.delete(row)
    for rel in paths:
        _delete_stored(rel)
    return True
