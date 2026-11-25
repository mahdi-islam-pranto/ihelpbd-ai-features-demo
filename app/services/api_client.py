"""
Bridge between the demo platform and the deployed AI APIs.

Each feature has its own adapter so we can match the exact request/response
contract of every API (documented in /api_docs). Until an API URL is
configured in .env the feature falls back to mock data (demo mode).
"""
import time
from dataclasses import dataclass

import httpx

from app.config import API_TIMEOUT, get_setting
from app.features import Feature
from app.services import mock_data


@dataclass
class RunInput:
    params: dict
    file_bytes: bytes | None = None
    filename: str | None = None
    content_type: str | None = None
    # batch features: several files [(name, bytes, content type)] or several links
    files: list[tuple[str, bytes, str]] | None = None
    urls: list[str] | None = None


class UpstreamError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _headers(feature: Feature) -> dict:
    key = feature.api["key"]
    return {"Authorization": f"Bearer {key}"} if key else {}


def _clean(params: dict, allowed: list[str]) -> dict:
    """Keep only known fields and drop empty optional values."""
    return {k: str(v).strip() for k, v in params.items()
            if k in allowed and v is not None and str(v).strip() != ""}


def _upstream_error(feature: Feature, resp: httpx.Response) -> UpstreamError:
    detail = resp.text[:400]
    try:
        body = resp.json()
        if isinstance(body, dict) and "detail" in body:
            d = body["detail"]
            if isinstance(d, list):  # FastAPI validation errors
                detail = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in d)
            else:
                detail = str(d)
    except ValueError:
        pass
    status = 400 if resp.status_code == 422 else 502
    return UpstreamError(f"{feature.name} API error ({resp.status_code}): {detail}", status)


async def _post(feature: Feature, data: dict, files: dict | list | None) -> dict:
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        resp = await client.post(feature.api["url"], data=data, files=files, headers=_headers(feature))
    if resp.status_code >= 400:
        raise _upstream_error(feature, resp)
    try:
        return resp.json()
    except ValueError:
        raise UpstreamError(f"{feature.name} API returned a non-JSON response")


# ---------------------------------------------------------------- adapters

async def _call_analysis(feature: Feature, inp: RunInput) -> dict:
    """POST /analyze-call  (see api_docs/recording_analysis.md)"""
    fields = ["language", "agent_name", "customer_name", "call_direction",
              "deal_or_lead_id", "product_or_service"]
    data = _clean(inp.params, fields)
    data.setdefault("language", "en")
    files = {"audio_file": (inp.filename or "recording", inp.file_bytes,
                            inp.content_type or "application/octet-stream")}
    return await _post(feature, data, files)


async def _transcribe(feature: Feature, inp: RunInput) -> dict:
    """POST /transcribe  (see api_docs/call_transcription.md). Send audio_url OR audio_file."""
    url = str(inp.params.get("audio_url") or "").strip()
    if url:
        # (None, value) = plain form field, keeps the request multipart/form-data
        return await _post(feature, {}, {"audio_url": (None, url)})
    files = {"audio_file": (inp.filename or "recording", inp.file_bytes,
                            inp.content_type or "application/octet-stream")}
    return await _post(feature, {}, files)


async def _find_leads(feature: Feature, inp: RunInput) -> dict:
    """POST /find_leads  (see api_docs/lead_finder.md). Send files OR audio_urls."""
    data = _clean(inp.params, ["lead_keywords", "business_context", "not_a_lead_criteria"])
    # (None, value) = plain form field; a list allows the repeated "files" field
    parts = [(k, (None, v)) for k, v in data.items()]
    if inp.urls:
        parts.append(("audio_urls", (None, "\n".join(inp.urls))))
    else:
        parts += [("files", (name, content, ctype or "application/octet-stream"))
                  for name, content, ctype in inp.files or []]
    return await _post(feature, {}, parts)


async def _crm_planner(feature: Feature, inp: RunInput) -> dict:
    """POST /crm/ai-dashboard with the CRM data as JSON (see api_docs/crm_planner.md).
    Auth: `token` and `ssh-key` headers from CRM_PLANNER_API_TOKEN / CRM_PLANNER_API_SSH_KEY."""
    headers = {name: value for name, env in (("token", "CRM_PLANNER_API_TOKEN"),
                                             ("ssh-key", "CRM_PLANNER_API_SSH_KEY"))
               if (value := get_setting(env).strip())}
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        resp = await client.post(feature.api["url"], json=inp.params["crm"], headers=headers)
    if resp.status_code >= 400:
        raise _upstream_error(feature, resp)
    try:
        data = resp.json()
    except ValueError:
        raise UpstreamError(f"{feature.name} API returned a non-JSON response")
    if not isinstance(data, dict) or not isinstance(data.get("ai_response"), dict):
        raise UpstreamError(f"{feature.name} API returned an unexpected response")
    return data


async def _generic(feature: Feature, inp: RunInput) -> dict:
    """Fallback for features whose contract isn't wired up yet."""
    files = None
    if inp.file_bytes is not None:
        files = {"file": (inp.filename or "upload", inp.file_bytes,
                          inp.content_type or "application/octet-stream")}
    return await _post(feature, inp.params, files)


ADAPTERS = {
    "call-recording-analysis": _call_analysis,
    "call-transcription": _transcribe,
    "lead-finder": _find_leads,
    "crm-ai-planner": _crm_planner,
}


async def run_feature(feature: Feature, inp: RunInput) -> dict:
    started = time.perf_counter()
    if feature.is_live:
        adapter = ADAPTERS.get(feature.slug, _generic)
        try:
            result = await adapter(feature, inp)
        except httpx.TimeoutException as exc:
            raise UpstreamError(f"{feature.name} API timed out after {API_TIMEOUT:.0f}s", 504) from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(f"Could not reach {feature.name} API: {exc}") from exc
        mode = "live"
    else:
        names = inp.urls or [f[0] for f in inp.files or []] or None
        result = await mock_data.generate(feature.slug, inp.params, inp.filename, names)
        mode = "demo"

    return {
        "feature": feature.slug,
        "mode": mode,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
        "input": {"file": inp.filename, **{k: v for k, v in inp.params.items() if v not in (None, "")}},
        "data": result,
    }
