"""
Database tables - one table per AI feature.

Every table shares the columns in `RunMixin` (who/when/what file/full JSON
response) and adds its own searchable columns pulled out of the response.
The full API response is always kept in `response`, so the frontend can
re-render a saved result exactly like a fresh one.

Adding a feature:
  1. create `class XxxRun(RunMixin, Base)` with __tablename__ + its columns
  2. implement `extract()` (response -> columns) and `card()` (history list)
  3. register it in HISTORY_MODELS under the feature slug
The table is created automatically on the next start.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def cut(value, length: int):
    """Trim strings so they always fit their VARCHAR column."""
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] or None


class RunMixin:
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"),
                                    primary_key=True, autoincrement=True, sort_order=-1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True,
                                                 comment="UTC", sort_order=-1)
    mode: Mapped[str] = mapped_column(String(10), comment="live | demo", sort_order=-1)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, sort_order=-1)
    source: Mapped[str] = mapped_column(String(10), default="none",
                                        comment="upload | sample | none", sort_order=-1)
    file_name: Mapped[str | None] = mapped_column(String(255), sort_order=-1)
    file_path: Mapped[str | None] = mapped_column(String(500),
                                                  comment="stored upload, relative to STORAGE_DIR", sort_order=-1)
    file_size: Mapped[int | None] = mapped_column(BigInteger, sort_order=-1)
    content_type: Mapped[str | None] = mapped_column(String(100), sort_order=-1)
    params: Mapped[dict | None] = mapped_column(JSON, comment="form inputs sent to the API", sort_order=1)
    response: Mapped[dict | None] = mapped_column(JSON, comment="full AI API response", sort_order=1)

    # --- per-feature hooks -------------------------------------------------
    search_columns: tuple[str, ...] = ("file_name",)

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        return {}

    def card(self) -> dict:
        """Compact info shown in the history list."""
        return {"title": self.file_name or f"Run #{self.id}", "subtitle": None, "tags": []}

    def list_item(self) -> dict:
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(timespec="seconds") + "Z",
            "mode": self.mode,
            "source": self.source,
            "file_name": self.file_name,
            "elapsed_ms": self.elapsed_ms,
            **self.card(),
        }


# =====================================================================
# Call Recording Analysis
# =====================================================================
SENTIMENT_TONES = {"positive": "green", "negative": "red", "neutral": "blue", "mixed": "amber"}


class CallAnalysisRun(RunMixin, Base):
    __tablename__ = "call_analysis_runs"
    __table_args__ = {"comment": "Call Recording Analysis results",
                      "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    # request
    language: Mapped[str | None] = mapped_column(String(8))
    agent_name: Mapped[str | None] = mapped_column(String(150))
    customer_name: Mapped[str | None] = mapped_column(String(150))
    call_direction: Mapped[str | None] = mapped_column(String(16))
    deal_or_lead_id: Mapped[str | None] = mapped_column(String(100), index=True)
    product_or_service: Mapped[str | None] = mapped_column(String(255))
    # response highlights
    customer_sentiment: Mapped[str | None] = mapped_column(String(32), index=True)
    call_outcome: Mapped[str | None] = mapped_column(Text)
    follow_up_required: Mapped[bool | None] = mapped_column(Boolean)
    summary: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    audio_tokens: Mapped[int | None] = mapped_column(Integer)

    search_columns = ("file_name", "agent_name", "customer_name", "deal_or_lead_id",
                      "product_or_service", "customer_sentiment")

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        a = (data or {}).get("analysis") or {}
        t = (data or {}).get("token_usage") or {}
        num = lambda v: v if isinstance(v, int) else None  # noqa: E731
        follow = a.get("follow_up_required")
        return {
            "language": cut(data.get("language") or params.get("language"), 8),
            "agent_name": cut(params.get("agent_name"), 150),
            "customer_name": cut(params.get("customer_name"), 150),
            "call_direction": cut(params.get("call_direction"), 16),
            "deal_or_lead_id": cut(params.get("deal_or_lead_id"), 100),
            "product_or_service": cut(params.get("product_or_service"), 255),
            "customer_sentiment": cut(str(a.get("customer_sentiment") or "").lower(), 32),
            "call_outcome": a.get("call_outcome") or None,
            "follow_up_required": follow if isinstance(follow, bool) else None,
            "summary": a.get("summary") or None,
            "input_tokens": num(t.get("input_tokens")),
            "output_tokens": num(t.get("output_tokens")),
            "total_tokens": num(t.get("total_tokens")),
            "audio_tokens": num(t.get("audio_tokens")),
        }

    def card(self) -> dict:
        tags = []
        if self.customer_sentiment:
            tags.append({"text": self.customer_sentiment.capitalize(),
                         "tone": SENTIMENT_TONES.get(self.customer_sentiment, "")})
        if self.language:
            tags.append({"text": self.language.upper(), "tone": ""})
        if self.follow_up_required:
            tags.append({"text": "Follow-up", "tone": "red"})
        people = " ↔ ".join(p for p in (self.agent_name, self.customer_name) if p)
        return {
            "title": self.file_name or f"Call #{self.id}",
            "subtitle": self.call_outcome or people or None,
            "tags": tags,
        }


# =====================================================================
# Call Transcription
# =====================================================================
def _fmt_duration(sec: float | None) -> str | None:
    if not sec:
        return None
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


class TranscriptionRun(RunMixin, Base):
    __tablename__ = "call_transcription_runs"
    __table_args__ = {"comment": "Call Transcription results",
                      "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    # request
    audio_url: Mapped[str | None] = mapped_column(String(1000), comment="set when transcribed from a link")
    # response highlights
    language: Mapped[str | None] = mapped_column(String(40), index=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    segment_count: Mapped[int | None] = mapped_column(Integer)
    speaker_count: Mapped[int | None] = mapped_column(Integer)
    model: Mapped[str | None] = mapped_column(String(100))
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    total_cost_usd: Mapped[float | None] = mapped_column(Float)
    processing_seconds: Mapped[float | None] = mapped_column(Float)
    preview: Mapped[str | None] = mapped_column(String(300), comment="first spoken line")
    full_text: Mapped[str | None] = mapped_column(Text().with_variant(MEDIUMTEXT(), "mysql"),
                                                 comment="plain transcript, for search")

    search_columns = ("file_name", "audio_url", "language", "full_text")

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        segs = [s for s in (data.get("segments") or []) if isinstance(s, dict)]
        usage = data.get("usage") or {}
        num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) else None  # noqa: E731
        lines = [f"{s.get('speaker', '')}: {s.get('text', '')}".strip() for s in segs]
        return {
            "audio_url": cut(params.get("audio_url") or data.get("audio_url"), 1000),
            "language": cut(data.get("language"), 40),
            "duration_seconds": num(data.get("duration_seconds")),
            "segment_count": len(segs),
            "speaker_count": len({s.get("speaker") for s in segs}),
            "model": cut(data.get("model"), 100),
            "total_tokens": num(usage.get("total_tokens")),
            "total_cost_usd": num(usage.get("total_cost_usd")),
            "processing_seconds": num(data.get("processing_seconds")),
            "preview": cut(lines[0] if lines else None, 300),
            "full_text": "\n".join(lines) or None,
        }

    def card(self) -> dict:
        tags = []
        if self.language:
            tags.append({"text": self.language, "tone": "blue"})
        if dur := _fmt_duration(self.duration_seconds):
            tags.append({"text": dur, "tone": ""})
        if self.segment_count:
            tags.append({"text": f"{self.segment_count} lines", "tone": ""})
        if self.source == "url":
            tags.append({"text": "Link", "tone": "amber"})
        title = self.file_name
        if not title and self.audio_url:
            title = self.audio_url.rstrip("/").rsplit("/", 1)[-1]
        return {"title": title or f"Transcript #{self.id}", "subtitle": self.preview, "tags": tags}


# =====================================================================
# Lead Finder AI  (one row = one batch of up to 1,000 calls)
# =====================================================================
class LeadFinderRun(RunMixin, Base):
    __tablename__ = "lead_finder_runs"
    __table_args__ = {"comment": "Lead Finder AI results (one row per batch of calls)",
                      "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=utcnow, comment="UTC, last chunk saved")
    # request (lead criteria; all empty = the API's default FedEx profile)
    lead_keywords: Mapped[str | None] = mapped_column(Text)
    business_context: Mapped[str | None] = mapped_column(Text)
    not_a_lead_criteria: Mapped[str | None] = mapped_column(Text)
    criteria_used: Mapped[str | None] = mapped_column(String(40), index=True)
    # counts
    planned_calls: Mapped[int | None] = mapped_column(Integer, comment="calls queued; > total_calls if stopped early")
    total_calls: Mapped[int | None] = mapped_column(Integer)
    analyzed: Mapped[int | None] = mapped_column(Integer)
    failed: Mapped[int | None] = mapped_column(Integer)
    potential_leads: Mapped[int | None] = mapped_column(Integer, index=True)
    strong_leads: Mapped[int | None] = mapped_column(Integer)
    potential_quality: Mapped[int | None] = mapped_column(Integer)
    weak_interest: Mapped[int | None] = mapped_column(Integer)
    not_a_lead: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    # where each call came from: {"<index>": {"kind": upload|sample|url, "name", "url"?, "path"?}}
    sources: Mapped[dict | None] = mapped_column(JSON, sort_order=1)
    sources_text: Mapped[str | None] = mapped_column(Text().with_variant(MEDIUMTEXT(), "mysql"),
                                                    comment="all file names / links, for search")
    leads_text: Mapped[str | None] = mapped_column(Text().with_variant(MEDIUMTEXT(), "mysql"),
                                                  comment="lead summaries and keywords, for search")

    search_columns = ("file_name", "sources_text", "lead_keywords", "business_context",
                      "not_a_lead_criteria", "criteria_used", "leads_text")

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        s = data.get("summary") or {}
        results = [r for r in data.get("results") or [] if isinstance(r, dict)]
        leads = [r for r in results if r.get("is_potential_lead")]
        num = lambda v: v if isinstance(v, int) and not isinstance(v, bool) else None  # noqa: E731
        lead_lines = [" | ".join(filter(None, [str(r.get("source") or ""), r.get("lead_quality"),
                                               ", ".join(r.get("keywords_matched") or []),
                                               r.get("customer_intent"), r.get("call_summary")]))
                      for r in leads]
        return {
            "lead_keywords": params.get("lead_keywords") or None,
            "business_context": params.get("business_context") or None,
            "not_a_lead_criteria": params.get("not_a_lead_criteria") or None,
            "criteria_used": cut(s.get("criteria_used"), 40),
            "total_calls": num(s.get("total_calls")),
            "analyzed": num(s.get("analyzed")),
            "failed": num(s.get("failed")),
            "potential_leads": num(s.get("potential_leads")),
            "strong_leads": num(s.get("strong_leads")),
            "potential_quality": num(s.get("potential_lead_quality")),
            "weak_interest": num(s.get("weak_interest")),
            "not_a_lead": num(s.get("not_a_lead")),
            "total_tokens": num(s.get("total_tokens_used")),
            "sources_text": "\n".join(str(r.get("source") or "") for r in results) or None,
            "leads_text": "\n".join(lead_lines) or None,
        }

    def card(self) -> dict:
        total = self.total_calls or 0
        leads = self.potential_leads or 0
        tags = [{"text": f"{leads} lead{'' if leads == 1 else 's'}", "tone": "green" if leads else ""}]
        if self.strong_leads:
            tags.append({"text": f"{self.strong_leads} strong", "tone": "blue"})
        if self.planned_calls and self.planned_calls > total:
            tags.append({"text": f"Partial {total}/{self.planned_calls}", "tone": "amber"})
        if self.failed:
            tags.append({"text": f"{self.failed} failed", "tone": "red"})
        if self.criteria_used and self.criteria_used.startswith("default"):
            subtitle = "Default FedEx criteria"
        else:
            subtitle = self.business_context or (f"Keywords: {self.lead_keywords}" if self.lead_keywords else None)
        name = (self.file_name or "").rstrip("/").rsplit("/", 1)[-1]
        title = name if total == 1 and name else f"{total} calls analyzed"
        return {"title": title, "subtitle": cut(subtitle, 160), "tags": tags, "icon": "target"}

    def stored_paths(self) -> list[str]:
        return [s["path"] for s in (self.sources or {}).values() if isinstance(s, dict) and s.get("path")]

    def stored_path(self, index: int | None) -> tuple[str | None, str | None]:
        src = (self.sources or {}).get(str(index)) if index is not None else None
        return (src.get("path"), src.get("name")) if isinstance(src, dict) else (None, None)


# =====================================================================
# CRM AI Planner  (one row = one daily plan; params.crm holds the CRM data sent)
# =====================================================================
class CrmPlannerRun(RunMixin, Base):
    __tablename__ = "crm_planner_runs"
    __table_args__ = {"comment": "CRM AI Planner results (one row per daily plan)",
                      "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

    # request
    scenario: Mapped[str | None] = mapped_column(String(40), index=True, comment="demo CRM id or 'custom'")
    industry: Mapped[str | None] = mapped_column(String(80))
    user_name: Mapped[str | None] = mapped_column(String(150), index=True)
    plan_date: Mapped[str | None] = mapped_column(String(20), comment="the CRM's 'today'")
    record_count: Mapped[int | None] = mapped_column(Integer, comment="CRM records sent")
    # response highlights
    plan_items: Mapped[int | None] = mapped_column(Integer)
    must_not_slip: Mapped[int | None] = mapped_column(Integer)
    at_risk_leads: Mapped[int | None] = mapped_column(Integer)
    overdue: Mapped[int | None] = mapped_column(Integer)
    open_commitments: Mapped[int | None] = mapped_column(Integer)
    minutes_planned: Mapped[int | None] = mapped_column(Integer)
    agent_errors: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    daily_summary: Mapped[str | None] = mapped_column(Text)
    plan_text: Mapped[str | None] = mapped_column(Text().with_variant(MEDIUMTEXT(), "mysql"),
                                                  comment="plan headlines and lead names, for search")

    search_columns = ("user_name", "industry", "scenario", "plan_date", "daily_summary", "plan_text")

    @classmethod
    def extract(cls, params: dict, data: dict) -> dict:
        from app.services.crm_planner import COLLECTIONS, scenario_meta
        crm = params.get("crm") if isinstance(params.get("crm"), dict) else {}
        ai = data.get("ai_response") if isinstance(data.get("ai_response"), dict) else {}
        counts = ai.get("counts") if isinstance(ai.get("counts"), dict) else {}
        num = lambda v: v if isinstance(v, int) and not isinstance(v, bool) else None  # noqa: E731
        items = lambda k: [x for x in ai.get(k) or [] if isinstance(x, dict)]  # noqa: E731
        plan, risks = items("today_plan"), items("lead_risk_alerts")
        tokens = [num(m.get("total_tokens")) for m in data.get("agent_metadata") or [] if isinstance(m, dict)]
        lines = [" | ".join(filter(None, [str(p.get("time_slot") or ""), p.get("lead_name"), p.get("headline")]))
                 for p in plan] + [f"risk | {r.get('lead_name')} | {r.get('issue')}" for r in risks]
        return {
            "scenario": cut(params.get("scenario"), 40),
            "industry": cut(scenario_meta(params.get("scenario")).get("industry")
                            or ("Custom CRM" if params.get("scenario") == "custom" else None), 80),
            "user_name": cut(crm.get("user_name"), 150),
            "plan_date": cut(crm.get("today"), 20),
            "record_count": sum(len(crm.get(c) or []) for c in COLLECTIONS) or None,
            "plan_items": len(plan),
            "must_not_slip": len(items("must_not_slip")),
            "at_risk_leads": num(counts.get("at_risk_leads")) if counts.get("at_risk_leads") is not None else len(risks),
            "overdue": num(counts.get("overdue")),
            "open_commitments": num(counts.get("open_commitments")),
            "minutes_planned": num(counts.get("total_minutes_planned")),
            "agent_errors": len(data.get("errors") or []),
            "total_tokens": sum(t for t in tokens if t) or None,
            "daily_summary": ai.get("daily_summary") or None,
            "plan_text": "\n".join(lines) or None,
        }

    def card(self) -> dict:
        tags = []
        if self.must_not_slip:
            tags.append({"text": f"{self.must_not_slip} must-do", "tone": "red"})
        if self.at_risk_leads:
            tags.append({"text": f"{self.at_risk_leads} at risk", "tone": "amber"})
        if self.plan_items:
            tags.append({"text": f"{self.plan_items} in plan", "tone": "blue"})
        if self.agent_errors:
            tags.append({"text": f"{self.agent_errors} agent error{'' if self.agent_errors == 1 else 's'}", "tone": "red"})
        title = " · ".join(filter(None, [self.user_name, self.industry])) or f"Plan #{self.id}"
        return {"title": title, "subtitle": cut(self.daily_summary or self.plan_date, 160), "tags": tags, "icon": "calendar"}


# feature slug -> table model. Features not listed here aren't saved yet.
HISTORY_MODELS: dict[str, type[RunMixin]] = {
    "call-recording-analysis": CallAnalysisRun,
    "call-transcription": TranscriptionRun,
    "lead-finder": LeadFinderRun,
    "crm-ai-planner": CrmPlannerRun,
}
