"""JSON API used by the frontend. The browser never talks to the AI APIs
directly - it goes through here so API keys stay on the server."""
import json
import logging
import mimetypes
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config import (AUDIO_EXTENSIONS, CRM_EXTENSIONS, SAMPLE_CRM_DIR,
                        SAMPLE_RECORDINGS_DIR)
from app.features import FEATURES, FEATURES_BY_SLUG
from app.db import database
from app.db.database import DatabaseUnavailable
from app.services import history
from app.services import crm_planner
from app.services import leads as lead_batch
from app.services.api_client import RunInput, UpstreamError, run_feature

log = logging.getLogger("ihelp.api")

router = APIRouter(prefix="/api")

SAMPLE_KINDS = {
    "recordings": (SAMPLE_RECORDINGS_DIR, AUDIO_EXTENSIONS),
    "crm": (SAMPLE_CRM_DIR, CRM_EXTENSIONS),
}

MAX_UPLOAD_MB = 100
BATCH_MAX_CALLS = 1000     # calls in one batch run
BATCH_MAX_CHUNK = 20       # calls per request (the browser sends a big batch in chunks)
SAMPLE_URLS_FILE = SAMPLE_RECORDINGS_DIR / "urls.txt"

# Features whose browser params are expanded/validated server side before the run:
# fn(params, live) -> params to send and save; raises ValueError (-> HTTP 400).
PARAM_PREPARERS = {
    "crm-ai-planner": crm_planner.prepare,
}


def _url_name(url: str) -> str:
    path = urlparse(url).path
    return unquote(PurePosixPath(path).name) or urlparse(url).netloc or url


def _valid_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


@router.get("/health")
async def health():
    """Liveness + database status (handy for server monitoring)."""
    return {"status": "ok", "database": await run_in_threadpool(database.status)}


@router.get("/features")
async def list_features():
    return [f.public_dict() for f in FEATURES]


@router.get("/crm-planner/scenarios")
async def crm_planner_scenarios():
    """Demo CRMs for the CRM AI Planner (meta + full CRM data for the preview)."""
    return await run_in_threadpool(crm_planner.scenario_list)


@router.get("/samples/urls")
async def list_sample_urls():
    """Sample audio links, one per line (or comma separated) in sample-call-recordings/urls.txt."""
    if not SAMPLE_URLS_FILE.is_file():
        return []
    text = SAMPLE_URLS_FILE.read_text(encoding="utf-8", errors="ignore")
    urls = [u.strip() for u in text.replace(",", "\n").splitlines()]
    return [{"name": _url_name(u), "url": u} for u in dict.fromkeys(urls) if _valid_url(u)]


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
    if not feature or feature.is_portal:
        raise HTTPException(404, "Feature not found")
    if feature.batch:
        raise HTTPException(400, f"Use /api/features/{slug}/batch for this feature.")

    try:
        parsed = json.loads(params or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid params JSON")
    if not isinstance(parsed, dict):
        raise HTTPException(400, "Invalid params JSON")
    if prepare := PARAM_PREPARERS.get(slug):
        try:
            parsed = prepare(parsed, feature.is_live)
        except ValueError as exc:
            raise HTTPException(400, str(exc))

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

    # Some features can take a link to the file instead of the file itself.
    audio_url = str(parsed.pop("audio_url", "") or "").strip()
    if audio_url:
        if not feature.accepts_url:
            raise HTTPException(400, "This feature does not accept links.")
        if file_bytes is not None:
            raise HTTPException(400, "Send either a file or a link, not both.")
        if not _valid_url(audio_url):
            raise HTTPException(400, "The link must be a full http:// or https:// URL.")
        parsed["audio_url"] = audio_url
        source = "url"
    elif feature.file_required and file_bytes is None:
        raise HTTPException(400, "Please upload a file, paste a link or choose a sample."
                            if feature.accepts_url else "Please upload a file or choose a sample.")
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


@router.post("/features/{slug}/batch")
async def run_batch(slug: str, files: list[UploadFile] = File(default=[]), params: str = Form("{}")):
    """One chunk of a batch run (e.g. Lead Finder).

    params JSON: the feature's form fields plus
      items:     [{"kind": "upload"} | {"kind": "sample", "name"} | {"kind": "url", "url"}]
                 in order; "upload" items take the uploaded `files` one by one
      offset:    position of the first item in the whole batch
      planned:   total calls in the batch
      append_to: saved run id returned by the first chunk (merges into it)
      save:      false = don't save (used when saving already failed for this batch)
    A chunk is either all files (uploads/samples) or all links: the API takes one or the other.
    """
    feature = FEATURES_BY_SLUG.get(slug)
    if not feature or not feature.batch:
        raise HTTPException(404, "Feature not found")
    try:
        parsed = json.loads(params or "{}")
        items = list(parsed.pop("items", None) or [])
        offset = int(parsed.pop("offset", 0) or 0)
        planned = int(parsed.pop("planned", 0) or 0)
        append_to = parsed.pop("append_to", None)
        append_to = int(append_to) if append_to not in (None, "") else None
        save = parsed.pop("save", True) is not False
    except (json.JSONDecodeError, TypeError, ValueError):
        raise HTTPException(400, "Invalid params JSON")

    if not items:
        raise HTTPException(400, "Add at least one call recording or link.")
    if len(items) > BATCH_MAX_CHUNK:
        raise HTTPException(400, f"Send at most {BATCH_MAX_CHUNK} calls per request.")
    if offset < 0 or offset + len(items) > BATCH_MAX_CALLS or planned > BATCH_MAX_CALLS:
        raise HTTPException(400, f"A run can have at most {BATCH_MAX_CALLS} calls.")
    kinds = {str((it or {}).get("kind")) for it in items}
    if not kinds <= {"upload", "sample", "url"}:
        raise HTTPException(400, "Unknown item kind.")
    if "url" in kinds and len(kinds) > 1:
        raise HTTPException(400, "A request can have files or links, not both.")

    uploads = iter(files)
    sources, file_parts, urls = [], [], []
    for it in items:
        kind = it["kind"]
        if kind == "url":
            url = str(it.get("url") or "").strip()
            if not _valid_url(url):
                raise HTTPException(400, f"Not a full http(s) link: {url[:80]}")
            urls.append(url)
            sources.append({"kind": "url", "name": _url_name(url), "url": url})
            continue
        if kind == "sample":
            content, name, ctype = _load_sample("recordings", str(it.get("name") or ""))
        else:
            upload = next(uploads, None)
            if upload is None or not upload.filename:
                raise HTTPException(400, "Missing uploaded file.")
            content, name, ctype = await upload.read(), upload.filename, upload.content_type
            if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
                raise HTTPException(413, f"{name} is too large (max {MAX_UPLOAD_MB} MB)")
        file_parts.append((name, content, ctype or "application/octet-stream"))
        sources.append({"kind": kind, "name": name, "bytes": content, "content_type": ctype})
    if next(uploads, None) is not None:
        raise HTTPException(400, "More files were uploaded than listed in items.")

    criteria = {k: str(parsed.get(k) or "").strip() for k in
                ("lead_keywords", "business_context", "not_a_lead_criteria")}
    try:
        payload = await run_feature(feature, RunInput(criteria, files=file_parts or None, urls=urls or None))
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise UpstreamError(f"{feature.name} API returned an unexpected response")
        payload["data"] = lead_batch.reindex(data, offset, len(items))
    except UpstreamError as exc:
        # Keep the batch going: every call in this chunk is recorded as failed.
        log.warning("%s chunk at %s failed: %s", slug, offset, exc)
        payload = {"feature": slug, "mode": feature.mode, "elapsed_ms": 0,
                   "data": lead_batch.error_chunk(sources, offset, str(exc)), "chunk_error": str(exc)}
    payload["input"] = {k: v for k, v in criteria.items() if v}

    if save and history.supports(slug):
        try:
            payload.update(await run_in_threadpool(
                history.save_batch, feature, payload, sources, offset, planned or len(items), append_to))
        except DatabaseUnavailable as exc:
            payload["history_error"] = f"Database not connected ({exc})"
        except Exception:  # noqa: BLE001
            log.exception("Saving %s batch chunk failed", slug)
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
async def get_history_file(slug: str, run_id: int, i: int | None = Query(None, ge=0)):
    """The stored upload of a saved run (batch runs: `i` = which call)."""
    _history_feature(slug)
    found = await _await_db(history.stored_file, slug, run_id, i)
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
