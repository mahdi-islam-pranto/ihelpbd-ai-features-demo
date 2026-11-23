"""JSON API used by the frontend. The browser never talks to the AI APIs
directly - it goes through here so API keys stay on the server."""
import json
import logging
import mimetypes

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config import (AUDIO_EXTENSIONS, CRM_EXTENSIONS, SAMPLE_CRM_DIR,
                        SAMPLE_RECORDINGS_DIR)
from app.features import FEATURES, FEATURES_BY_SLUG
from app.db import database
from app.db.database import DatabaseUnavailable
from app.services import history
from app.services.api_client import RunInput, UpstreamError, run_feature

log = logging.getLogger("ihelp.api")

router = APIRouter(prefix="/api")

SAMPLE_KINDS = {
    "recordings": (SAMPLE_RECORDINGS_DIR, AUDIO_EXTENSIONS),
    "crm": (SAMPLE_CRM_DIR, CRM_EXTENSIONS),
}

MAX_UPLOAD_MB = 100


@router.get("/health")
async def health():
    """Liveness + database status (handy for server monitoring)."""
    return {"status": "ok", "database": await run_in_threadpool(database.status)}


@router.get("/features")
async def list_features():
    return [f.public_dict() for f in FEATURES]


@router.get("/samples/{kind}")
async def list_samples(kind: str):
    if kind not in SAMPLE_KINDS:
        raise HTTPException(404, "Unknown sample type")
    folder, exts = SAMPLE_KINDS[kind]
    if not folder.exists():
        return []
    return [
        {"name": p.name, "url": f"/samples/{kind}/{p.name}", "size": p.stat().st_size}
        for p in sorted(folder.iterdir())
        if p.is_file() and p.suffix.lower() in exts
    ]


def _load_sample(kind: str, name: str) -> tuple[bytes, str, str]:
    folder, exts = SAMPLE_KINDS[kind]
    path = (folder / name).resolve()
    # prevent path traversal outside the sample folder
    if path.parent != folder.resolve() or not path.is_file() or path.suffix.lower() not in exts:
        raise HTTPException(404, "Sample file not found")
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return path.read_bytes(), path.name, ctype


@router.post("/features/{slug}/run")
async def run(
    slug: str,
    file: UploadFile | None = File(None),
    sample: str | None = Form(None),
    sample_kind: str | None = Form(None),
    params: str = Form("{}"),
):
    feature = FEATURES_BY_SLUG.get(slug)
    if not feature:
        raise HTTPException(404, "Feature not found")

    try:
        parsed = json.loads(params or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid params JSON")

    file_bytes = filename = ctype = None
    source = "none"
    if file is not None and file.filename:
        file_bytes = await file.read()
        if len(file_bytes) > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"File too large (max {MAX_UPLOAD_MB} MB)")
        filename, ctype = file.filename, file.content_type
        source = "upload"
    elif sample:
        sample_kind = sample_kind or feature.file_kind
        if sample_kind not in SAMPLE_KINDS:
            raise HTTPException(400, "Unknown sample type")
        file_bytes, filename, ctype = _load_sample(sample_kind, sample)
        source = "sample"

    if feature.file_required and file_bytes is None:
        raise HTTPException(400, "Please upload a file or choose a sample.")
    for f in feature.form_fields:
        if f.get("required") and not str(parsed.get(f["name"], "")).strip():
            raise HTTPException(400, f"'{f['label']}' is required.")

    try:
        payload = await run_feature(feature, RunInput(parsed, file_bytes, filename, ctype))
    except UpstreamError as exc:
        raise HTTPException(exc.status_code if exc.status_code >= 400 else 502, str(exc))

    # Save to history. A database problem never hides the AI result.
    if history.supports(slug):
        try:
            payload.update(await run_in_threadpool(
                history.save_run, feature, payload, source, file_bytes, filename, ctype))
        except DatabaseUnavailable as exc:
            payload["history_error"] = f"Database not connected ({exc})"
        except Exception:  # noqa: BLE001
            log.exception("Saving %s result failed", slug)
            payload["history_error"] = "Could not save this result (see server log)."
    return payload


# ------------------------------------------------------------------ history
def _history_feature(slug: str):
    feature = FEATURES_BY_SLUG.get(slug)
    if not feature:
        raise HTTPException(404, "Feature not found")
    if not history.supports(slug):
        raise HTTPException(404, "History is not available for this feature yet")
    return feature


@router.get("/features/{slug}/history")
async def list_history(slug: str, limit: int = Query(15, ge=1, le=100),
                       offset: int = Query(0, ge=0), q: str = Query("", max_length=100)):
    _history_feature(slug)
    try:
        result = await run_in_threadpool(history.list_runs, slug, limit, offset, q)
    except DatabaseUnavailable as exc:
        return {"enabled": False, "error": str(exc), "total": 0, "items": []}
    return {"enabled": True, **result}


async def _await_db(func, *args):
    try:
        return await run_in_threadpool(func, *args)
    except DatabaseUnavailable as exc:
        raise HTTPException(503, f"Database not connected ({exc})")


@router.get("/features/{slug}/history/{run_id}")
async def get_history(slug: str, run_id: int):
    feature = _history_feature(slug)
    run = await _await_db(history.get_run, feature, run_id)
    if run is None:
        raise HTTPException(404, "Saved result not found")
    return run


@router.get("/features/{slug}/history/{run_id}/file")
async def get_history_file(slug: str, run_id: int):
    _history_feature(slug)
    found = await _await_db(history.stored_file, slug, run_id)
    if not found:
        raise HTTPException(404, "File not stored for this result")
    path, name, ctype = found
    return FileResponse(path, media_type=ctype or mimetypes.guess_type(name)[0],
                        filename=name, content_disposition_type="inline")


@router.delete("/features/{slug}/history/{run_id}")
async def delete_history(slug: str, run_id: int):
    _history_feature(slug)
    if not await _await_db(history.delete_run, slug, run_id):
        raise HTTPException(404, "Saved result not found")
    return {"deleted": run_id}
