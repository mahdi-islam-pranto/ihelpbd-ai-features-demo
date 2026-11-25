"""
CRM AI Planner helpers: demo CRM scenarios, request validation and demo responses.

Each scenario in app/data/crm_planner/<id>.json is a complete request body for
POST /crm/ai-dashboard plus a "_scenario" block (label, industry, persona) that
is stripped before sending. app/data/crm_planner/demo/<id>.json is the matching
demo-mode response (same shape as the live API, see api_docs/crm_planner.md).
"""
import copy
import json
from functools import lru_cache

from app.config import APP_DIR

DATA_DIR = APP_DIR / "data" / "crm_planner"
DEMO_DIR = DATA_DIR / "demo"
SCENARIO_ORDER = ["saas_sales", "real_estate", "logistics", "education"]

COLLECTIONS = ("all_tasks", "all_followups", "all_notes", "all_calls", "all_messages")
MAX_ITEMS = 400            # records across all collections in one request
MAX_TEXT = 20_000          # characters in one field (transcripts are the longest)


class InvalidCrmData(ValueError):
    pass


def _read(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _scenarios() -> dict[str, dict]:
    found = {p.stem: _read(p) for p in DATA_DIR.glob("*.json")}
    ordered = [k for k in SCENARIO_ORDER if k in found] + sorted(k for k in found if k not in SCENARIO_ORDER)
    return {k: found[k] for k in ordered}


def scenario_list() -> list[dict]:
    """Scenarios for the input panel: meta + the CRM data (for the preview)."""
    out = []
    for sid, raw in _scenarios().items():
        meta = raw.get("_scenario") or {}
        body = request_body(sid)
        out.append({
            "id": sid,
            "industry": meta.get("industry") or sid,
            "title": meta.get("title") or "",
            "persona": meta.get("persona") or "",
            "accent": meta.get("accent") or "blue",
            "icon": meta.get("icon") or "grid",
            "counts": {c: len(body.get(c) or []) for c in COLLECTIONS},
            "crm": body,
        })
    return out


def request_body(scenario_id: str) -> dict:
    raw = _scenarios().get(scenario_id)
    if raw is None:
        raise InvalidCrmData(f"Unknown demo scenario '{scenario_id}'.")
    return {k: copy.deepcopy(v) for k, v in raw.items() if not k.startswith("_")}


def validate(data) -> dict:
    """Light checks on user-supplied CRM data (the API validates the details)."""
    if not isinstance(data, dict):
        raise InvalidCrmData("CRM data must be a JSON object.")
    data = {k: v for k, v in data.items() if not str(k).startswith("_")}
    for key in ("user_name", "today"):
        if not str(data.get(key) or "").strip():
            raise InvalidCrmData(f"CRM data needs a '{key}' field.")
    total = 0
    for c in COLLECTIONS:
        items = data.setdefault(c, [])
        if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise InvalidCrmData(f"'{c}' must be a list of objects.")
        total += len(items)
    if total == 0:
        raise InvalidCrmData("CRM data has no tasks, follow-ups, notes, calls or messages.")
    if total > MAX_ITEMS:
        raise InvalidCrmData(f"Too many records ({total}); send at most {MAX_ITEMS}.")
    if any(len(str(v)) > MAX_TEXT for c in COLLECTIONS for i in data[c] for v in i.values()):
        raise InvalidCrmData(f"A field is longer than {MAX_TEXT:,} characters.")
    return data


def prepare(params: dict, live: bool) -> dict:
    """Turn the browser's params into what is sent and saved: {scenario, crm}.

    params: {"scenario": "<id>"} for a demo CRM, or {"scenario": "custom", "crm": {...}}.
    """
    sid = str(params.get("scenario") or "").strip()
    if sid and sid != "custom":
        return {"scenario": sid, "crm": request_body(sid)}
    if "crm" not in params:
        raise InvalidCrmData("Choose a demo CRM or provide your own CRM data.")
    if not live:
        raise InvalidCrmData("Your own CRM data needs the live API. In demo mode, pick one of the demo CRMs.")
    return {"scenario": "custom", "crm": validate(params.get("crm"))}


def demo_response(params: dict) -> dict:
    sid = params.get("scenario")
    path = DEMO_DIR / f"{sid}.json"
    if not path.is_file():
        raise InvalidCrmData(f"No demo response for scenario '{sid}'.")
    return _read(path)


def scenario_meta(scenario_id: str | None) -> dict:
    raw = _scenarios().get(scenario_id or "") or {}
    return raw.get("_scenario") or {}
