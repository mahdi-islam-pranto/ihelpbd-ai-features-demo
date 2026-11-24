"""
Lead Finder batch helpers.

A big run (up to 1,000 calls) is sent to the AI API in small chunks. Each
chunk's response is merged into one result with the same shape as a single
/find_leads response, so the frontend and the database only ever see one.
The JS twin of `summarize` lives in static/js/lead_input.js (mergeChunk).
"""

QUALITY_KEYS = {           # lead_quality text -> summary counter
    "strong": "strong_leads",
    "potential": "potential_lead_quality",
    "weak": "weak_interest",
    "not": "not_a_lead",
}


def quality_key(result: dict) -> str | None:
    q = str(result.get("lead_quality") or "").lower()
    if "strong" in q:
        return "strong"
    if "weak" in q:
        return "weak"
    if "not" in q:
        return "not"
    if "potential" in q:
        return "potential"
    return None


def is_ok(result: dict) -> bool:
    return str(result.get("status") or "success").lower() == "success"


def summarize(results: list[dict], criteria_used: str | None) -> dict:
    ok = [r for r in results if is_ok(r)]
    summary = {
        "criteria_used": criteria_used,
        "total_calls": len(results),
        "analyzed": len(ok),
        "failed": len(results) - len(ok),
        "potential_leads": sum(bool(r.get("is_potential_lead")) for r in ok),
        **{key: 0 for key in QUALITY_KEYS.values()},
        "total_tokens_used": sum(int(r.get("tokens_used") or 0) for r in results),
    }
    for r in ok:
        if (k := quality_key(r)) is not None:
            summary[QUALITY_KEYS[k]] += 1
    return summary


def reindex(data: dict, offset: int, count: int) -> dict:
    """Give a chunk's results their position in the whole batch."""
    def fix(items):
        out = []
        for pos, r in enumerate(items or []):
            if not isinstance(r, dict):
                continue
            local = r.get("index")
            local = local if isinstance(local, int) and 0 <= local < count else pos
            out.append({**r, "index": offset + local})
        return out
    return {**data, "results": fix(data.get("results")), "leads": fix(data.get("leads"))}


def error_chunk(sources: list[dict], offset: int, message: str) -> dict:
    """Result for a chunk whose API call failed: every call in it is marked failed."""
    results = [{
        "index": offset + i, "source": s.get("url") or s.get("name"),
        "source_type": "url" if s.get("kind") == "url" else "file",
        "status": "error", "error": message, "call_summary": None, "customer_intent": None,
        "is_potential_lead": False, "lead_quality": "Not a Lead", "confidence_score": 0,
        "keywords_matched": [], "other_lead_signals": [], "business_requirements": [],
        "justification": None, "tokens_used": 0,
    } for i, s in enumerate(sources)]
    return {"summary": summarize(results, None), "leads": [], "results": results}


def merge(base: dict | None, chunk: dict) -> dict:
    """Merge a chunk into the batch result so far (a re-sent index replaces the old one)."""
    by_index = {r["index"]: r for r in (base or {}).get("results") or [] if isinstance(r, dict)}
    by_index.update({r["index"]: r for r in chunk.get("results") or []})
    results = [by_index[i] for i in sorted(by_index)]
    criteria = (chunk.get("summary") or {}).get("criteria_used") \
        or ((base or {}).get("summary") or {}).get("criteria_used")
    return {
        "summary": summarize(results, criteria),
        "leads": [r for r in results if is_ok(r) and r.get("is_potential_lead")],
        "results": results,
    }
